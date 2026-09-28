"""From two points on the map to trip options the UI can show as-is."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from . import shapes
from .data import Timetable
from .router import DESTINATION, ORIGIN, Access, Journey, Preferences, Router

# Streets do not run as the crow flies. An estimate, not a measurement: walking
# directions would replace it. It errs towards promising too little time.
DETOUR_FACTOR = 1.3
WALK_LIMITS = {"short": 400, "normal": 800, "long": 1500}


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(a)))


def walk_m(lat1, lon1, lat2, lon2) -> int:
    return round(distance_m(lat1, lon1, lat2, lon2) * DETOUR_FACTOR)


@dataclass
class Point:
    lat: float
    lon: float
    name: str


# Longer than any city or suburban route in the five feeds (the longest,
# Klaipėda's 115 to Rusnė, spans 43 km); the intercity coaches span 120 km
# and more.
INTERCITY_KM = 60
_intercity: tuple[Timetable, dict[int, frozenset[int]]] | None = None


def intercity_patterns(t: Timetable) -> dict[int, frozenset[int]]:
    """Per stop, the intercity patterns that call there. Worked out once."""
    global _intercity
    if _intercity is not None and _intercity[0] is t:
        return _intercity[1]
    at_stop: dict[int, set[int]] = {}
    for pattern, stops in enumerate(t.pattern_stops):
        if not stops:
            continue
        first = stops[0]
        extent = max(distance_m(t.stop_lat[first], t.stop_lon[first], t.stop_lat[s], t.stop_lon[s]) for s in stops)
        if extent >= INTERCITY_KM * 1000:
            for stop in stops:
                at_stop.setdefault(stop, set()).add(pattern)
    frozen = {stop: frozenset(patterns) for stop, patterns in at_stop.items()}
    _intercity = (t, frozen)
    return frozen


# Past the dozen nearest stops, this many more city platforms at most, each
# kept only for a line no nearer platform has.
EXTRA_STOPS = 8


def usable_patterns(t: Timetable, stop: int, role: str | None = None) -> set[int]:
    """The patterns a rider can use at a stop: to board at the start of a trip
    ("origin"), to get off at its end ("destination"), or either (None). A
    line that ends at a platform takes nobody away from it."""
    usable = set()
    for pattern, index in t.patterns_at_stop[stop]:
        if role == "origin" and index == len(t.pattern_stops[pattern]) - 1:
            continue
        if role == "destination" and index == 0:
            continue
        usable.add(pattern)
    return usable


def stops_near(t: Timetable, point: Point, limit_m: int, max_count: int = 12,
               role: str | None = None) -> list[Access]:
    found = []
    for stop, (lat, lon) in enumerate(zip(t.stop_lat, t.stop_lon)):
        # Cheap reject before the trigonometry: 0.02° is > 1.2 km here.
        if abs(lat - point.lat) > 0.03 or abs(lon - point.lon) > 0.05:
            continue
        metres = walk_m(point.lat, point.lon, lat, lon)
        if metres <= limit_m:
            found.append(Access(stop, metres))
    found.sort(key=lambda a: a.metres)
    chosen = found[:max_count]
    # The dozen nearest platforms of a busy interchange do not serve every
    # line there. At Vilnius "Stotis" the platform where lines 3, 4, 41, 42,
    # 54 and 78 end is the 13th nearest, and the coach stand of Vilnius AS
    # the 14th. A farther stop is kept when it serves a pattern none of the
    # kept ones do: a coach stand whatever its rank, city platforms up to
    # EXTRA_STOPS of them, nearest first.
    coaches = intercity_patterns(t)
    served = set().union(*(usable_patterns(t, a.stop, role) for a in chosen))
    extra = 0
    for access in found[max_count:]:
        new = usable_patterns(t, access.stop, role) - served
        if not new:
            continue
        coach = not new.isdisjoint(coaches.get(access.stop, ()))
        if coach or extra < EXTRA_STOPS:
            chosen.append(access)
            served |= new
            extra += not coach
    return chosen


def service_day(moment: datetime) -> tuple[int, int]:
    return moment.year * 10_000 + moment.month * 100 + moment.day, moment.weekday()


def plan(
    t: Timetable,
    origin: Point,
    destination: Point,
    when: datetime,
    arrive_by: bool,
    priority: str = "fastest",
    walk: str = "normal",
    now: datetime | None = None,
    skip: set[tuple[int, int]] | None = None,
) -> dict:
    """Plan a trip. `when` and `now` are Vilnius wall-clock times, naive.

    `skip`: (pattern, trip) of the trips called off today, as the live feed
    says (vc.live); only a search on today's service leaves them out.

    With `now`, "be there by" never offers a trip that should already have
    started. When none is left, the answer is the fastest way from now,
    marked late: "late_by_min" is how many minutes after `when` the best of
    them arrives, and each option that arrives after `when` has "late" set.
    """
    prefs = Preferences(max_walk_metres=WALK_LIMITS.get(walk, 800))
    today = (now or datetime.now()).date()
    off = lambda moment: skip if skip and moment.date() == today else None  # noqa: E731
    options, counts = _options(t, origin, destination, when, arrive_by, prefs, off(when))
    late_by_min = None

    if arrive_by and now is not None:
        midnight = when.replace(hour=0, minute=0, second=0, microsecond=0)
        cutoff = (now - midnight).total_seconds() - 60
        options = [o for o in options if o["leave_s"] >= cutoff]
        if not options:
            # The router sees one service day at a time: when nothing runs
            # for the rest of today (the last coach has gone), start from the
            # next morning, up to the day that was asked about.
            start = now
            for _ in range(3):
                options, counts = _options(t, origin, destination, start, False, prefs, off(start))
                if options or start.date() >= when.date():
                    break
                start = start.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1)
            priority, arrive_by = "fastest", False
            start_midnight = start.replace(hour=0, minute=0, second=0, microsecond=0)
            for o in options:
                o["late"] = start_midnight + timedelta(seconds=o["arrive_s"]) > when
            if options:
                best = start_midnight + timedelta(seconds=min(o["arrive_s"] for o in options))
                if best > when:
                    late_by_min = math.ceil((best - when).total_seconds() / 60)

    rank(options, priority, arrive_by)
    tag(options, arrive_by)
    # Trips are planned inside one city. When the two ends are in different
    # cities the answer is empty for a reason the rider should be told, not
    # a bare "no route".
    from_city = city_at(t, origin.lat, origin.lon)
    to_city = city_at(t, destination.lat, destination.lon)
    return {
        "options": options,
        "late": late_by_min is not None,
        "late_by_min": late_by_min,
        "from_city": from_city,
        "to_city": to_city,
        "cross_city": bool(from_city and to_city and from_city != to_city),
        **counts,
    }


def city_at(t: Timetable, lat: float, lon: float, within_m: float = 3000) -> str | None:
    """The city of the nearest stop within `within_m`, or None out of town."""
    cities = getattr(t, "stop_city", None)
    if not cities:
        return None
    best, best_m = None, within_m
    for stop, (slat, slon) in enumerate(zip(t.stop_lat, t.stop_lon)):
        if abs(slat - lat) > 0.03 or abs(slon - lon) > 0.05:
            continue
        metres = distance_m(lat, lon, slat, slon)
        if metres < best_m:
            best, best_m = cities[stop], metres
    return best


# The bus station, where a city's lines meet and where a visitor starts. Found
# by name in each city's own feed; Panevėžys's city feed has none, so there
# the busiest stop near the middle of the network stands in.
STATION_NAMES = {"stotis", "autobusų stotis", "autobusų stoties st."}


def _base_name(name: str) -> str:
    # Kaunas names carry a platform letter ("Autobusų stotis A").
    return name[:-2] if len(name) > 2 and name[-2] == " " and name[-1] in "ABCDEF" else name


def city_summaries(t: Timetable) -> list[dict]:
    """Each city with a point to start from, derived from the data."""
    groups: dict[str, list[int]] = {}
    for stop, city in enumerate(getattr(t, "stop_city", None) or ["Vilnius"] * len(t.stop_names)):
        groups.setdefault(city, []).append(stop)

    def weight(i: int) -> tuple[int, int]:
        patterns = t.patterns_at_stop[i]
        return len({t.pattern_route[p] for p, _ in patterns}), len(patterns)

    out = []
    for city, stops in groups.items():
        stations = [i for i in stops if _base_name(t.stop_names[i]).casefold() in STATION_NAMES]
        if stations:
            hub = max(stations, key=weight)
        else:
            lat = sum(t.stop_lat[i] for i in stops) / len(stops)
            lon = sum(t.stop_lon[i] for i in stops) / len(stops)
            central = [i for i in stops if distance_m(lat, lon, t.stop_lat[i], t.stop_lon[i]) <= 1500] or stops
            hub = max(central, key=weight)
        out.append({"name": city, "stops": len(stops), "stop": _base_name(t.stop_names[hub]),
                    "lat": t.stop_lat[hub], "lon": t.stop_lon[hub]})
    out.sort(key=lambda c: -c["stops"])
    return out


def _options(
    t: Timetable,
    origin: Point,
    destination: Point,
    when: datetime,
    arrive_by: bool,
    prefs: Preferences,
    skip: set[tuple[int, int]] | None = None,
) -> tuple[list[dict], dict]:
    """Trip options, not yet ranked or tagged, and how many stops each end has."""
    router = Router(t, prefs)

    midnight = when.replace(hour=0, minute=0, second=0, microsecond=0)
    today = service_day(midnight)
    yesterday = service_day(midnight - timedelta(days=1))
    seconds = int((when - midnight).total_seconds())

    # Widen the net if nothing is in reach: better a longer walk than no answer.
    origins = destinations = []
    for factor in (1.0, 1.6, 2.5):
        origins = stops_near(t, origin, int(prefs.max_walk_metres * factor), role="origin")
        destinations = stops_near(t, destination, int(prefs.max_walk_metres * factor), role="destination")
        if origins and destinations:
            break

    journeys: list[Journey] = []

    def search(at: int) -> list[Journey]:
        if not origins or not destinations:
            return []
        return [j for j in router.journeys(origins, destinations, at, today, yesterday, skip) if j.rides > 0]

    def add(found: list[Journey]) -> None:
        for journey in found:
            if all(not same(journey, known) for known in journeys):
                journeys.append(journey)

    direct = walk_m(origin.lat, origin.lon, destination.lat, destination.lon)

    if arrive_by:
        # The latest departure that still arrives in time. Arrival does not
        # get earlier by leaving later, so a binary search over minutes works.
        # Three hours covers any trip within a city. A coach between cities
        # takes nearly four and runs a few times a day, so look further back
        # there; a trip that must start more than twelve hours ahead is no
        # answer to "be there by", and the caller says so instead.
        apart = distance_m(origin.lat, origin.lon, destination.lat, destination.lon)
        window = 3 * 3600 if apart < INTERCITY_KM * 1000 else 12 * 3600
        low, high = seconds - window, seconds
        found_at = None
        while low <= high:
            middle = (low + high) // 2 // 60 * 60
            options = search(middle)
            if options and min(j.arrival for j in options) <= seconds:
                found_at = middle
                low = middle + 60
            else:
                high = middle - 60
        if found_at is not None:
            # A little earlier too: the latest possible departure is often a
            # tight connection, and a calmer one a few minutes before is worth
            # showing next to it.
            for earlier in (0, 6 * 60, 12 * 60):
                add([j for j in search(found_at - earlier) if j.arrival <= seconds])
    else:
        add(search(seconds))
        # The next departures too, so a missed bus is not the end of the plan.
        # Stepping a minute can land on the same bus caught one stop further
        # on, so keep stepping until something genuinely different turns up.
        cursor = seconds
        for _ in range(10):
            if not journeys or len({j.departure for j in journeys}) >= 3:
                break
            cursor = max(cursor, max(j.departure for j in journeys)) + 60
            if cursor > seconds + 3600:
                break
            add(search(cursor))

    # Earliest arrival is not the same as a sensible plan: at night it can mean
    # leaving at 00:50 to wait four hours at a stop. Leave as late as still
    # arrives at the same time instead.
    journeys = [tighten(j, search) for j in journeys]
    journeys = pareto(journeys)[:6]
    options = [option_json(t, j, midnight, origin, destination) for j in journeys]

    if direct <= max(prefs.max_walk_metres * 2, 1000):
        duration = prefs.walk_seconds(direct)
        start = seconds - duration if arrive_by else seconds
        options.append(walk_only_json(midnight, start, duration, direct, origin, destination))

    return options, {"origin_stops": len(origins), "destination_stops": len(destinations)}


def same(a: Journey, b: Journey) -> bool:
    rides = lambda j: [(l.pattern, l.trip, l.shift) for l in j.legs if l.kind == "ride"]  # noqa: E731
    return rides(a) == rides(b)


def waiting(journey: Journey) -> int:
    """Seconds spent standing still between legs."""
    legs = journey.legs
    return sum(max(0, b.departure - a.arrival) for a, b in zip(legs, legs[1:]))


def tighten(journey: Journey, search) -> Journey:
    """The latest departure that still arrives no later than `journey`."""
    if waiting(journey) < 15 * 60:
        return journey
    low, high = journey.departure, journey.arrival
    best = journey
    while low <= high:
        middle = (low + high) // 2 // 60 * 60
        found = [j for j in search(middle) if j.arrival <= journey.arrival]
        if found:
            best = min(found, key=lambda j: (j.rides, j.arrival))
            low = middle + 60
        else:
            high = middle - 60
    return best


def dominates(a: Journey, b: Journey) -> bool:
    """a is at least as good as b in every way that matters, and better in one."""
    # Fewer vehicles, arriving no more than a minute later and leaving no more
    # than five minutes sooner: nobody takes two extra changes for that.
    if (
        a.rides < b.rides
        and a.arrival <= b.arrival + 60
        and a.departure >= b.departure - 300
    ):
        return True
    no_worse = (
        a.departure >= b.departure
        and a.arrival <= b.arrival
        and a.rides <= b.rides
        and a.walk_metres <= b.walk_metres + 100
    )
    better = (
        a.departure > b.departure
        or a.arrival < b.arrival
        or a.rides < b.rides
        or a.walk_metres + 100 < b.walk_metres
    )
    return no_worse and better


def pareto(journeys: list[Journey]) -> list[Journey]:
    kept = [j for j in journeys if not any(dominates(k, j) for k in journeys if k is not j)]
    return sorted(kept, key=lambda j: (j.arrival, j.rides))


# A change of vehicle costs this much in "fastest" ranking: a 2-minute gain is
# not worth getting off, crossing the street and waiting again.
TRANSFER_COST = 180


def rank(options: list[dict], priority: str, arrive_by: bool = False) -> None:
    if priority == "fewest":
        options.sort(key=lambda o: (o["transfers"], o["arrive_s"], o["walk_m"]))
    elif priority == "single":
        options.sort(key=lambda o: (o["transfers"] > 0, o["arrive_s"], o["walk_m"]))
    elif arrive_by:
        # "Be there by nine" means leave as late as is sensible.
        options.sort(key=lambda o: (-(o["leave_s"] - TRANSFER_COST * o["transfers"]), o["walk_m"]))
    else:
        options.sort(key=lambda o: (o["arrive_s"] + TRANSFER_COST * o["transfers"], o["walk_m"]))


def tag(options: list[dict], arrive_by: bool) -> None:
    if not options:
        return
    fastest = min(o["arrive_s"] for o in options)
    latest_leave = max(o["leave_s"] for o in options)
    least_walk = min(o["walk_m"] for o in options)
    for o in options:
        tags = []
        if arrive_by and o["leave_s"] == latest_leave and len(options) > 1:
            tags.append("Išeik vėliausiai")
        if not arrive_by and o["arrive_s"] == fastest:
            tags.append("Greičiausias")
        if o["transfers"] == 0 and not o["walk_only"]:
            tags.append("Be persėdimų")
        if o["walk_m"] == least_walk and len(options) > 1 and not o["walk_only"]:
            tags.append("Mažiausiai ėjimo")
        o["tags"] = tags


# -- JSON --------------------------------------------------------------------

def clock(midnight: datetime, seconds: int) -> dict:
    moment = midnight + timedelta(seconds=seconds)
    return {"iso": moment.isoformat(timespec="seconds"), "hm": moment.strftime("%H:%M")}


def route_json(t: Timetable, pattern: int) -> dict:
    route = t.routes[t.pattern_route[pattern]]
    return {
        "name": route.short_name,
        "category": route.category,
        "color": route.color,
        "text_color": route.text_color,
    }


def place(t: Timetable, stop: int, origin: Point, destination: Point) -> dict:
    if stop == ORIGIN:
        return {"name": origin.name, "lat": origin.lat, "lon": origin.lon, "stop": None}
    if stop == DESTINATION:
        return {"name": destination.name, "lat": destination.lat, "lon": destination.lon, "stop": None}
    return {"name": t.stop_names[stop], "lat": t.stop_lat[stop], "lon": t.stop_lon[stop], "stop": stop}


def option_json(t: Timetable, journey: Journey, midnight: datetime, origin: Point, destination: Point) -> dict:
    legs = []
    for leg in journey.legs:
        item = {
            "kind": leg.kind,
            "from": place(t, leg.from_stop, origin, destination),
            "to": place(t, leg.to_stop, origin, destination),
            "departure": clock(midnight, leg.departure),
            "arrival": clock(midnight, leg.arrival),
            "minutes": max(1, round((leg.arrival - leg.departure) / 60)),
            "metres": leg.metres,
        }
        if leg.kind == "ride":
            stops = t.pattern_stops[leg.pattern]
            trip = t.pattern_trips[leg.pattern][leg.trip]
            item["route"] = route_json(t, leg.pattern)
            item["headsign"] = t.pattern_headsign[leg.pattern]
            # Which vehicle run this is, so live data can find it again.
            item["trip"] = [leg.pattern, leg.trip, leg.shift, leg.board_index, leg.alight_index,
                            midnight.strftime("%Y-%m-%d")]
            item["stop_count"] = leg.alight_index - leg.board_index
            # The street it drives, where the feed has it: drawn instead of
            # straight lines from stop to stop.
            street = shapes.of(t).ride(leg.pattern, leg.board_index, leg.alight_index)
            if street:
                item["shape"], item["shape_m"] = street["coords"], street["stops"]
            item["stops"] = [
                {
                    "name": t.stop_names[stops[i]],
                    "lat": t.stop_lat[stops[i]],
                    "lon": t.stop_lon[stops[i]],
                    "time": clock(midnight, trip[1][i] + leg.shift),
                }
                for i in range(leg.board_index, leg.alight_index + 1)
            ]
        legs.append(item)

    rides = [l for l in legs if l["kind"] == "ride"]
    return {
        "id": "-".join(f"{l.pattern}.{l.trip}.{l.shift}" for l in journey.legs if l.kind == "ride"),
        "leave": clock(midnight, journey.departure),
        "arrive": clock(midnight, journey.arrival),
        "leave_s": journey.departure,
        "arrive_s": journey.arrival,
        "duration_min": round((journey.arrival - journey.departure) / 60),
        "walk_m": journey.walk_metres,
        "transfers": max(0, len(rides) - 1),
        "walk_only": False,
        "late": False,
        "routes": [l["route"] for l in rides],
        "first_departure": rides[0]["departure"] if rides else None,
        "first_stop": rides[0]["from"]["name"] if rides else None,
        "legs": legs,
    }


def walk_only_json(midnight, start, duration, metres, origin: Point, destination: Point) -> dict:
    leg = {
        "kind": "walk",
        "from": {"name": origin.name, "lat": origin.lat, "lon": origin.lon, "stop": None},
        "to": {"name": destination.name, "lat": destination.lat, "lon": destination.lon, "stop": None},
        "departure": clock(midnight, start),
        "arrival": clock(midnight, start + duration),
        "minutes": max(1, round(duration / 60)),
        "metres": metres,
    }
    return {
        "id": "walk",
        "leave": leg["departure"],
        "arrive": leg["arrival"],
        "leave_s": start,
        "arrive_s": start + duration,
        "duration_min": round(duration / 60),
        "walk_m": metres,
        "transfers": 0,
        "walk_only": True,
        "late": False,
        "routes": [],
        "first_departure": None,
        "first_stop": None,
        "legs": [leg],
    }
