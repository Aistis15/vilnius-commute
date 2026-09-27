"""Where the buses are right now: stops.lt's live feeds, matched to trips.

stops.lt publishes the position of every city vehicle a few times a minute;
it is the feed behind stops.lt's own map. What each city publishes (checked
2026-09-27):

  Vilnius    gps_full.txt  position, delay and the GTFS trip id
  Kaunas     gps_full.txt  position, delay, route and the trip's start minute
  Klaipėda   gps_full.txt  as Kaunas
  (Panevėžys publishes positions only and Šiauliai nothing; neither is in
  the product.)

NuokrypisSekundemis is actual minus scheduled, in seconds: positive is late.
Checked against the timetable the same day: for 122 Vilnius buses standing
at a stop, the clock minus the scheduled departure matched it within a
median 24 s; with the sign flipped the median error was 148 s. Matched to a
trip that day: Vilnius 327 of 360 vehicles, Kaunas 131 of 142, Klaipėda 95
of 99 (the rest were going to or from the depot).

A delay seen now is assumed to hold for the rest of the trip. Buses do make
up time, which is why the app never moves "leave now" later by the whole
delay (see withLive in web/app.js).
"""

from __future__ import annotations

import csv
import io
import threading
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta

from .data import USER_AGENT, Timetable

FEEDS = {
    "Vilnius": "https://www.stops.lt/vilnius/gps_full.txt",
    "Kaunas": "https://www.stops.lt/kaunas/gps_full.txt",
    "Klaipėda": "https://www.stops.lt/klaipeda/gps_full.txt",
}
# Trip ids in the database are namespaced by feed ('vilnius:A1-01-...').
SLUGS = {"Vilnius": "vilnius", "Kaunas": "kaunas", "Klaipėda": "klaipeda"}

REFRESH_S = 15      # a city is fetched at most this often, and only on demand
STALE_S = 120       # older than this, a snapshot is not "live" any more
LOST_S = 300        # a vehicle silent for five minutes is not on the road
TROLLEYBUS = "Troleibusai"


@dataclass
class Vehicle:
    city: str
    route: str
    trolleybus: bool
    lat: float
    lon: float
    bearing: int | None
    delay: int | None               # seconds, positive = late; None = unknown
    trip: tuple[int, int] | None    # (pattern, index into pattern_trips)
    headsign: str
    number: str


def _int(value) -> int | None:
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def clock_seconds(moment: datetime) -> int:
    return moment.hour * 3600 + moment.minute * 60 + moment.second


def parse_full(text: str, clock_s: int) -> list[dict]:
    """The rows of a gps_full.txt, not yet matched to trips. Vilnius says when
    each position was measured; a vehicle silent for LOST_S is left out."""
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        lat, lon = _int(row.get("Platuma")), _int(row.get("Ilguma"))
        route = (row.get("Marsrutas") or "").strip()
        if not lat or not lon or not route:
            continue
        measured = _int(row.get("MatavimoLaikas"))
        if measured is not None and (clock_s - measured) % 86_400 > LOST_S:
            continue
        out.append({
            "route": route,
            "trolleybus": (row.get("Transportas") or "").strip() == TROLLEYBUS,
            "lat": lat / 1e6, "lon": lon / 1e6,
            "bearing": _int(row.get("Azimutas")),
            "delay": _int(row.get("NuokrypisSekundemis")),
            "start": _int(row.get("ReisoPradziaMinutemis")),
            "gtfs_trip": (row.get("ReisoIdGTFS") or "").strip(),
            "headsign": (row.get("KryptiesPavadinimas") or "").strip(),
            "number": (row.get("MasinosNumeris") or "").strip(),
        })
    return out


class Matcher:
    """Finds the timetable trip a vehicle is running: by its GTFS id where the
    feed gives one (Vilnius), else by route and the trip's first departure,
    then direction, then where the timetable says the trip should be now."""

    def __init__(self, t: Timetable):
        self.t = t
        self.by_gtfs: dict[str, tuple[int, int]] = {}
        self.by_start: dict[tuple[str, str, int], list[tuple[int, int]]] = {}
        ids = getattr(t, "pattern_trip_ids", None) or [[] for _ in t.pattern_trips]
        for pattern, trips in enumerate(t.pattern_trips):
            stops = t.pattern_stops[pattern]
            if not stops:
                continue
            city = t.stop_city[stops[0]] if t.stop_city else "Vilnius"
            route = t.routes[t.pattern_route[pattern]].short_name
            for index, trip in enumerate(trips):
                if index < len(ids[pattern]):
                    self.by_gtfs[ids[pattern][index]] = (pattern, index)
                self.by_start.setdefault((city, route, trip[2][0]), []).append((pattern, index))

    def match(self, city: str, v: dict, today: tuple[int, int], yesterday: tuple[int, int],
              clock_s: int) -> tuple[int, int] | None:
        if v["gtfs_trip"]:
            return self.by_gtfs.get(f"{SLUGS.get(city, city.lower())}:{v['gtfs_trip']}")
        if v["start"] is None or v["delay"] is None:
            return None
        start = v["start"] * 60
        # Today's trips; yesterday's still running, whose times run past 24:00.
        keys = ((today, start), (yesterday, start), (yesterday, start + 86_400))
        found = []
        for (date, weekday), first in keys:
            for pattern, index in self.by_start.get((city, v["route"], first), ()):
                route = self.t.routes[self.t.pattern_route[pattern]]
                if (route.category == "trolleybus") != v["trolleybus"]:
                    continue
                if self.t.runs(self.t.pattern_trips[pattern][index][0], date, weekday):
                    found.append((pattern, index))
        if len(found) > 1 and v["headsign"]:
            wanted = v["headsign"].casefold()
            same = [c for c in found if (self.t.pattern_headsign[c[0]] or "").casefold() == wanted]
            found = same or found
        if len(found) > 1:
            found.sort(key=lambda c: self._off_course(c, v, clock_s))
        return found[0] if found else None

    def _off_course(self, candidate: tuple[int, int], v: dict, clock_s: int) -> float:
        """How far the vehicle is from where this trip should be now."""
        pattern, index = candidate
        departures = self.t.pattern_trips[pattern][index][2]
        k = sum(1 for d in departures if d + (v["delay"] or 0) <= clock_s) - 1
        stop = self.t.pattern_stops[pattern][max(0, min(k, len(departures) - 1))]
        return abs(self.t.stop_lat[stop] - v["lat"]) + abs(self.t.stop_lon[stop] - v["lon"])


def _fetch(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=6) as response:
        return response.read().decode("utf-8", "replace")


class Live:
    """Live vehicles per city, fetched on demand and at most every REFRESH_S.

    The first request for a city waits for the feed (up to the fetch
    timeout); later ones get the last snapshot at once while a background
    thread refreshes it. A failed fetch keeps the old snapshot until it is
    STALE_S old, after which the city simply has no live data.
    """

    def __init__(self, t: Timetable, fetch=_fetch, clock=datetime.now):
        self.t = t
        self.fetch = fetch
        self.clock = clock
        self.matcher: Matcher | None = None
        self.lock = threading.Lock()
        self.snapshots: dict[str, tuple[float, list[Vehicle], dict]] = {}
        self.pending: set[str] = set()

    def has_feed(self, city: str | None) -> bool:
        return city in FEEDS

    def vehicles(self, city: str) -> list[Vehicle] | None:
        snapshot = self._snapshot(city)
        return snapshot[1] if snapshot else None

    def in_box(self, south: float, west: float, north: float, east: float) -> list[dict]:
        """The vehicles in service inside a map view, in their route's colour.
        Ones not matched to a trip (to or from the depot) are left out: a bus
        that takes nobody anywhere is noise on the map."""
        out = []
        for city in FEEDS:
            for vehicle in self.vehicles(city) or []:
                if vehicle.trip is None or not (south <= vehicle.lat <= north and west <= vehicle.lon <= east):
                    continue
                pattern = vehicle.trip[0]
                route = self.t.routes[self.t.pattern_route[pattern]]
                out.append({
                    "key": f"{city}:{vehicle.number or vehicle.route}:{pattern}",
                    "route": route.short_name, "color": route.color, "text_color": route.text_color,
                    "headsign": self.t.pattern_headsign[pattern] or "",
                    "lat": vehicle.lat, "lon": vehicle.lon, "bearing": vehicle.bearing, "delay_s": vehicle.delay,
                })
        return out

    def vehicle_on(self, pattern: int, trip: int) -> Vehicle | None:
        stops = self.t.pattern_stops[pattern]
        city = self.t.stop_city[stops[0]] if stops and self.t.stop_city else "Vilnius"
        snapshot = self._snapshot(city)
        return snapshot[2].get((pattern, trip)) if snapshot else None

    def _snapshot(self, city: str):
        if city not in FEEDS:
            return None
        with self.lock:
            snapshot = self.snapshots.get(city)
            due = snapshot is None or time.monotonic() - snapshot[0] >= REFRESH_S
            start = due and city not in self.pending
            if start:
                self.pending.add(city)
        if start:
            if snapshot is None:
                self._refresh(city)
            else:
                threading.Thread(target=self._refresh, args=(city,), daemon=True).start()
        with self.lock:
            snapshot = self.snapshots.get(city)
        if snapshot is None or time.monotonic() - snapshot[0] > STALE_S:
            return None
        return snapshot

    def _refresh(self, city: str) -> None:
        try:
            text = self.fetch(FEEDS[city])
            now = self.clock()
            clock_s = clock_seconds(now)
            rows = parse_full(text, clock_s)
            if self.matcher is None:
                self.matcher = Matcher(self.t)
            today = (now.year * 10_000 + now.month * 100 + now.day, now.weekday())
            before = now - timedelta(days=1)
            yesterday = (before.year * 10_000 + before.month * 100 + before.day, before.weekday())
            vehicles, by_trip = [], {}
            for row in rows:
                trip = self.matcher.match(city, row, today, yesterday, clock_s)
                vehicle = Vehicle(city=city, route=row["route"], trolleybus=row["trolleybus"],
                                  lat=row["lat"], lon=row["lon"], bearing=row["bearing"],
                                  delay=row["delay"] if trip else None, trip=trip,
                                  headsign=row["headsign"], number=row["number"])
                vehicles.append(vehicle)
                if trip:
                    by_trip[trip] = vehicle
            with self.lock:
                self.snapshots[city] = (time.monotonic(), vehicles, by_trip)
        except Exception:  # noqa: BLE001 - no live data is a normal state
            pass
        finally:
            with self.lock:
                self.pending.discard(city)

    # -- what the app shows ---------------------------------------------------

    def leg_state(self, pattern: int, trip: int, shift: int, board: int, alight: int,
                  midnight: datetime, now: datetime) -> dict | None:
        """The live state of one ride: its vehicle, delay and expected times,
        in the frame of the plan's `midnight`. None when nothing is known."""
        vehicle = self.vehicle_on(pattern, trip)
        if vehicle is None or vehicle.delay is None:
            return None
        _service, arrivals, departures = self.t.pattern_trips[pattern][trip]
        now_s = int((now - midnight).total_seconds())
        delay = vehicle.delay
        # The last stop it has left, going by the timetable plus its delay.
        left = sum(1 for d in departures if d + shift + delay <= now_s) - 1
        return {
            "delay_s": delay,
            "expected": _clock(midnight, departures[board] + shift + delay),
            "expected_arrival": _clock(midnight, arrivals[alight] + shift + delay),
            # Stops still to come before it reaches the rider's: 1 means the
            # next stop is theirs, 0 that it is there (or waiting at the first
            # stop, when they board there).
            "stops_away": board if left < 0 else max(0, board - left),
            "left_index": left,
            "departed": left >= board,
            "lat": vehicle.lat,
            "lon": vehicle.lon,
            "bearing": vehicle.bearing,
            "vehicle": vehicle.number,
        }

    def ride_state(self, ref: list, now: datetime) -> dict | None:
        """leg_state for a ride's "trip" reference, as the planner writes it:
        [pattern, trip, shift, board, alight, "YYYY-MM-DD" of its midnight]."""
        pattern, trip, shift, board, alight, day = ref
        if not (0 <= pattern < len(self.t.pattern_trips) and 0 <= trip < len(self.t.pattern_trips[pattern])):
            return None
        midnight = datetime.fromisoformat(day)
        # Only rides around now: yesterday's plan for this hour is not this bus.
        departure = midnight + timedelta(seconds=self.t.pattern_trips[pattern][trip][2][board] + shift)
        if abs((departure - now).total_seconds()) > 3 * 3600:
            return None
        return self.leg_state(pattern, trip, shift, board, alight, midnight, now)

    def annotate(self, options: list[dict], now: datetime) -> None:
        """Adds "live" to every ride whose vehicle is on the road."""
        for option in options:
            for leg in option.get("legs", []):
                if leg.get("kind") == "ride" and leg.get("trip"):
                    state = self.ride_state(leg["trip"], now)
                    if state:
                        leg["live"] = state


def _clock(midnight: datetime, seconds: int) -> dict:
    moment = midnight + timedelta(seconds=seconds)
    return {"iso": moment.isoformat(timespec="seconds"), "hm": moment.strftime("%H:%M")}
