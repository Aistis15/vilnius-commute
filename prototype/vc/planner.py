"""From two points on the map to trip options the UI can show as-is."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

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


def stops_near(t: Timetable, point: Point, limit_m: int, max_count: int = 12) -> list[Access]:
    found = []
    for stop, (lat, lon) in enumerate(zip(t.stop_lat, t.stop_lon)):
        # Cheap reject before the trigonometry: 0.02° is > 1.2 km here.
        if abs(lat - point.lat) > 0.03 or abs(lon - point.lon) > 0.05:
            continue
        metres = walk_m(point.lat, point.lon, lat, lon)
        if metres <= limit_m:
            found.append(Access(stop, metres))
    found.sort(key=lambda a: a.metres)
    return found[:max_count]


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
) -> dict:
    """Plan a trip. `when` is a Vilnius wall-clock time, naive."""
    prefs = Preferences(max_walk_metres=WALK_LIMITS.get(walk, 800))
    router = Router(t, prefs)

    midnight = when.replace(hour=0, minute=0, second=0, microsecond=0)
    today = service_day(midnight)
    yesterday = service_day(midnight - timedelta(days=1))
    seconds = int((when - midnight).total_seconds())

    # Widen the net if nothing is in reach: better a longer walk than no answer.
    origins = destinations = []
    for factor in (1.0, 1.6, 2.5):
        origins = stops_near(t, origin, int(prefs.max_walk_metres * factor))
        destinations = stops_near(t, destination, int(prefs.max_walk_metres * factor))
        if origins and destinations:
            break

    journeys: list[Journey] = []

    def search(at: int) -> list[Journey]:
        if not origins or not destinations:
            return []
        return [j for j in router.journeys(origins, destinations, at, today, yesterday) if j.rides > 0]

    def add(found: list[Journey]) -> None:
        for journey in found:
            if all(not same(journey, known) for known in journeys):
                journeys.append(journey)

    if arrive_by:
        # The latest departure that still arrives in time. Arrival does not
        # get earlier by leaving later, so a binary search over minutes works.
        low, high = seconds - 3 * 3600, seconds
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

    direct = walk_m(origin.lat, origin.lon, destination.lat, destination.lon)
    if direct <= max(prefs.max_walk_metres * 2, 1000):
        duration = prefs.walk_seconds(direct)
        start = seconds - duration if arrive_by else seconds
        options.append(walk_only_json(midnight, start, duration, direct, origin, destination))

    rank(options, priority, arrive_by)
    tag(options, arrive_by)
    return {
        "options": options,
        "origin_stops": len(origins),
        "destination_stops": len(destinations),
    }


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
            item["stop_count"] = leg.alight_index - leg.board_index
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
        "routes": [],
        "first_departure": None,
        "first_stop": None,
        "legs": [leg],
    }
