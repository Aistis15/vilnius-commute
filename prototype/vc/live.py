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

How fresh, measured 2026-09-27 on Vilnius (every bus, once a second, for
200 s): gps_full.txt is rewritten every ~5.3 s and a position in it is a
median 7.8 s old when fetched. The app used to show a bus a median 16.7 s
behind, 110 m from where it really was when moving (p90 207 m): the server
fetched only when asked, answered with the snapshot of the ask before, and
the app asked every 5 s. Now a background poll asks every POLL_S while
anyone is looking (an unchanged file answers 304, no body), each change is
pushed to the app at once (/api/stream), and every position carries when it
was measured and the bus's speed, so the app moves it on along its heading
for the time since (web/app.js, ahead()). On the same recording: 20 m median
(p90 53 m) for moving buses.

The GTFS-Realtime feeds (vc/gtfsrt.py) give the trips that will not run.
"""

from __future__ import annotations

import csv
import io
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime

from . import gtfsrt, shapes
from .data import USER_AGENT, Timetable

FEEDS = {
    "Vilnius": "https://www.stops.lt/vilnius/gps_full.txt",
    "Kaunas": "https://www.stops.lt/kaunas/gps_full.txt",
    "Klaipėda": "https://www.stops.lt/klaipeda/gps_full.txt",
}
# The trips that will not run: GTFS-Realtime trip updates marked CANCELED.
RT_FEEDS = {
    "Vilnius": "https://www.stops.lt/vilnius/gtfs_realtime.pb",
    "Kaunas": "https://www.stops.lt/kaunas/gtfs_realtime.pb",
    "Klaipėda": "https://www.stops.lt/klaipeda/trip_updates.pb",
}
# Trip ids in the database are namespaced by feed ('vilnius:A1-01-...').
SLUGS = {"Vilnius": "vilnius", "Kaunas": "kaunas", "Klaipėda": "klaipeda"}

POLL_S = 2          # while anyone looks, each city's file is asked for this often
ACTIVE_S = 90       # a city nobody has asked about for this long is not polled
CANCEL_POLL_S = 30  # cancellations change seldom
STALE_S = 120       # older than this, a snapshot is not "live" any more
LOST_S = 300        # a vehicle silent for five minutes is not on the road
# Kaunas and Klaipėda do not say when each position was measured. Measured
# for Klaipėda 2026-09-27 against its GTFS-RT, which times the same fixes: a
# position is a median 4 s old when the file carrying it is written (p10 3 s,
# p90 7 s). Kaunas, the same system, is assumed alike (not measured).
FILE_AGE_S = 4
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
    measured: float | None = None   # when the position was taken, epoch seconds
    speed: float | None = None      # m/s, as the vehicle reported it
    along: float | None = None      # metres along its line's street; None off it


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
        kmh = _int(row.get("Greitis"))
        out.append({
            "route": route,
            "trolleybus": (row.get("Transportas") or "").strip() == TROLLEYBUS,
            "lat": lat / 1e6, "lon": lon / 1e6,
            "bearing": _int(row.get("Azimutas")),
            "speed": kmh / 3.6 if kmh is not None and 0 <= kmh < 150 else None,
            "measured": measured,
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


def _fetch(url: str, etag: str | None = None) -> tuple[bytes | None, str | None, float | None]:
    """(body, etag, Last-Modified as epoch seconds); body None when the file
    has not changed since `etag` (stops.lt answers 304 then, no body)."""
    headers = {"User-Agent": USER_AGENT}
    if etag:
        headers["If-None-Match"] = etag
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=6) as response:
            modified = response.headers.get("Last-Modified")
            return (response.read(), response.headers.get("ETag"),
                    parsedate_to_datetime(modified).timestamp() if modified else None)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return None, etag, None
        raise


class Live:
    """Live vehicles per city.

    The first request for a city waits for the feed (up to the fetch
    timeout). After start(), a background thread keeps every city asked
    about in the last ACTIVE_S fresh, every POLL_S, and wakes whoever waits
    in wait_for_change(); without it (tests), a city is refetched on demand.
    A failed fetch keeps the old snapshot until it is STALE_S old, after
    which the city simply has no live data. `fetch(url)` may be given in
    place of stops.lt: it returns the feed's body, or (body, etag,
    Last-Modified) as _fetch does.
    """

    def __init__(self, t: Timetable, fetch=None, clock=datetime.now):
        self.t = t
        self.get = _fetch if fetch is None else (
            lambda url, etag=None: (lambda got: got if isinstance(got, tuple) else (got, None, None))(fetch(url)))
        self.clock = clock
        self.matcher: Matcher | None = None
        self.lock = threading.Lock()
        # city -> {"checked": monotonic, "vehicles": [...], "by_trip": {...}}
        self.snapshots: dict[str, dict] = {}
        self.pending: set[str] = set()
        self.etags: dict[str, str | None] = {}
        self.wanted: dict[str, float] = {}
        self.cancelled: dict[str, tuple[float, set[tuple[int, int]]]] = {}
        self.version = 0
        self.changed = threading.Condition()
        self.polling = False

    def start(self) -> None:
        """Polls the cities being looked at, in the background."""
        if not self.polling:
            self.polling = True
            threading.Thread(target=self._poll, daemon=True).start()

    def _poll(self) -> None:
        asked_cancelled: dict[str, float] = {}
        while True:
            started = time.monotonic()
            with self.lock:
                active = [city for city, at in self.wanted.items() if started - at <= ACTIVE_S]
            for city in active:
                self._refresh(city)
                if started - asked_cancelled.get(city, -1e9) >= CANCEL_POLL_S:
                    asked_cancelled[city] = started
                    self._refresh_cancelled(city)
            time.sleep(max(0.2, POLL_S - (time.monotonic() - started)))

    def wait_for_change(self, seen: int, timeout: float) -> int:
        """The snapshots' version, once it is not `seen` (or after `timeout`)."""
        with self.changed:
            if self.version == seen:
                self.changed.wait(timeout)
            return self.version

    def _changed(self) -> None:
        with self.changed:
            self.version += 1
            self.changed.notify_all()

    def has_feed(self, city: str | None) -> bool:
        return city in FEEDS

    def vehicles(self, city: str) -> list[Vehicle] | None:
        snapshot = self._snapshot(city)
        return snapshot["vehicles"] if snapshot else None

    def in_box(self, south: float, west: float, north: float, east: float) -> list[dict]:
        """The vehicles in service inside a map view, in their route's colour,
        with when each position was taken and the speed then, for the app to
        move it on. Ones not matched to a trip (to or from the depot) are
        left out: a bus that takes nobody anywhere is noise on the map."""
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
                    **_motion(vehicle),
                })
        return out

    def vehicle_on(self, pattern: int, trip: int) -> Vehicle | None:
        stops = self.t.pattern_stops[pattern]
        city = self.t.stop_city[stops[0]] if stops and self.t.stop_city else "Vilnius"
        snapshot = self._snapshot(city)
        return snapshot["by_trip"].get((pattern, trip)) if snapshot else None

    def _snapshot(self, city: str):
        if city not in FEEDS:
            return None
        now = time.monotonic()
        with self.lock:
            self.wanted[city] = now
            snapshot = self.snapshots.get(city)
            idle = city not in self.pending
            first = snapshot is None and idle
            due = not self.polling and snapshot is not None and now - snapshot["checked"] >= POLL_S and idle
            if first or due:
                self.pending.add(city)
        if first:
            self._refresh(city)
            if not self.polling:
                self._refresh_cancelled(city)
        elif due:
            threading.Thread(target=self._refresh, args=(city,), daemon=True).start()
        with self.lock:
            snapshot = self.snapshots.get(city)
        if snapshot is None or time.monotonic() - snapshot["checked"] > STALE_S:
            return None
        return snapshot

    def _refresh(self, city: str) -> None:
        url = FEEDS[city]
        try:
            body, etag, modified = self.get(url, self.etags.get(url))
            checked = time.monotonic()
            if body is None:                 # unchanged since the last ask
                with self.lock:
                    if city in self.snapshots:
                        self.snapshots[city]["checked"] = checked
                return
            text = body.decode("utf-8", "replace") if isinstance(body, bytes) else body
            now = self.clock()
            clock_s = clock_seconds(now)
            rows = parse_full(text, clock_s)
            if self.matcher is None:
                self.matcher = Matcher(self.t)
            today = (now.year * 10_000 + now.month * 100 + now.day, now.weekday())
            before = now - timedelta(days=1)
            yesterday = (before.year * 10_000 + before.month * 100 + before.day, before.weekday())
            midnight = now.replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            streets = shapes.of(self.t)
            vehicles, by_trip = [], {}
            for row in rows:
                trip = self.matcher.match(city, row, today, yesterday, clock_s)
                if row["measured"] is not None:
                    # Seconds of the day: a fix from before midnight is yesterday's.
                    measured = midnight + row["measured"]
                    if measured > now.timestamp() + 600:
                        measured -= 86_400
                else:
                    measured = modified - FILE_AGE_S if modified is not None else None
                vehicle = Vehicle(city=city, route=row["route"], trolleybus=row["trolleybus"],
                                  lat=row["lat"], lon=row["lon"], bearing=row["bearing"],
                                  delay=row["delay"] if trip else None, trip=trip,
                                  headsign=row["headsign"], number=row["number"],
                                  measured=measured, speed=row["speed"])
                if trip:
                    # On its street, near where the timetable and its delay
                    # say it is: GPS puts a bus 5-20 m off the road at times.
                    departures = self.t.pattern_trips[trip[0]][trip[1]][2]
                    left = sum(1 for d in departures if d + (vehicle.delay or 0) <= clock_s) - 1
                    vehicle.along = streets.place(trip[0], vehicle.lat, vehicle.lon, max(0, left))
                vehicles.append(vehicle)
                if trip:
                    by_trip[trip] = vehicle
            with self.lock:
                self.etags[url] = etag
                self.snapshots[city] = {"checked": checked, "vehicles": vehicles, "by_trip": by_trip}
            self._changed()
        except Exception:  # noqa: BLE001 - no live data is a normal state
            pass
        finally:
            with self.lock:
                self.pending.discard(city)

    def _refresh_cancelled(self, city: str) -> None:
        """The trips of today the city's GTFS-Realtime feed calls off."""
        url = RT_FEEDS.get(city)
        if url is None:
            return
        try:
            body, etag, _modified = self.get(url, self.etags.get(url))
            if body is None:
                with self.lock:
                    if city in self.cancelled:
                        self.cancelled[city] = (time.monotonic(), self.cancelled[city][1])
                return
            feed = gtfsrt.parse(body if isinstance(body, bytes) else body.encode("utf-8"))
            if self.matcher is None:
                self.matcher = Matcher(self.t)
            slug = SLUGS.get(city, city.lower())
            trips = {self.matcher.by_gtfs[key] for key in (f"{slug}:{trip_id}" for trip_id in gtfsrt.cancelled(feed))
                     if key in self.matcher.by_gtfs}
            with self.lock:
                self.etags[url] = etag
                changed = self.cancelled.get(city, (0, None))[1] != trips
                self.cancelled[city] = (time.monotonic(), trips)
            if changed:
                self._changed()
        except Exception:  # noqa: BLE001 - without the feed nothing is known to be cancelled
            pass

    def cancelled_trips(self) -> set[tuple[int, int]]:
        """(pattern, trip) of every trip called off today, as last heard (and
        not longer ago than STALE_S: an old "cancelled" is not news)."""
        now = time.monotonic()
        with self.lock:
            return {trip for at, trips in self.cancelled.values() if now - at <= STALE_S for trip in trips}

    # -- what the app shows ---------------------------------------------------

    def leg_state(self, pattern: int, trip: int, shift: int, board: int, alight: int,
                  midnight: datetime, now: datetime) -> dict | None:
        """The live state of one ride: its vehicle, delay and expected times,
        in the frame of the plan's `midnight`. None when nothing is known;
        {"cancelled": True} for today's trip the operator has called off."""
        if shift == 0 and midnight.date() == now.date() and (pattern, trip) in self.cancelled_trips():
            return {"cancelled": True}
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
            **_motion(vehicle),
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


def _motion(vehicle: Vehicle) -> dict:
    """When the position was taken (epoch ms), how fast the vehicle went, and
    how far along its line's street it was, for the app to move it on along
    the street to where it is by now."""
    return {"measured_ms": round(vehicle.measured * 1000) if vehicle.measured is not None else None,
            "speed": round(vehicle.speed, 1) if vehicle.speed is not None else None,
            "pattern": vehicle.trip[0] if vehicle.trip else None,
            "along": round(vehicle.along, 1) if vehicle.along is not None else None}


def _clock(midnight: datetime, seconds: int) -> dict:
    moment = midnight + timedelta(seconds=seconds)
    return {"iso": moment.isoformat(timespec="seconds"), "hm": moment.strftime("%H:%M")}
