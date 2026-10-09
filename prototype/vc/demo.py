"""Demo mode: every bus where its timetable says it is, with no network.

For showing the app where stops.lt cannot be reached or cannot be trusted
to be up (a classroom, a pitch, a weekend rehearsal for a weekday demo).
`python server.py --demo` swaps the live feed (vc/live.py) for this; the
app cannot tell the difference, because these vehicles come out of the
same `Live` methods in the same shape: on the map, on the boards, "už 3
stotelių" in the banner, the bus gliding along its street.

What is real and what is not:
  - Real: the trips, their times, their streets (the same timetable the
    planner routes on). A bus is shown on the trip the operator scheduled,
    between the two stops the timetable puts it between, at the speed that
    gets it to the next one on time.
  - Not real: the position is not a GPS fix, and every bus runs exactly on
    time unless a delay is set by hand (/api/demo/late), so the "late bus"
    feature can be shown on cue. Nothing is called off.

`--demo 08:15` also moves the clock: the server and the app run at that
time of today from the moment the server starts, at normal speed, so the
morning rush can be shown in the evening. The app learns the offset from
/api/status.
"""

from __future__ import annotations

import math
import threading
import time
from bisect import bisect_right
from datetime import datetime, timedelta

from . import shapes
from .live import FEEDS, Live, Vehicle, clock_seconds

TICK_S = 1.0            # how often the app is told the buses have moved


def parse_clock(value: str, today: datetime) -> datetime:
    """"08:15" as that time of `today`."""
    hours, minutes = (int(x) for x in value.split(":"))
    return today.replace(hour=hours, minute=minutes, second=0, microsecond=0)


class ScheduledLive(Live):
    """`Live` with the timetable standing in for stops.lt. `clock()` is the
    demo's now; vehicles are worked out for it, at most once a second."""

    def __init__(self, t, clock=datetime.now):
        super().__init__(t, fetch=lambda url: "", clock=clock)
        self.delays: dict[tuple[int, int], int] = {}
        self._cache: dict[str, tuple[int, dict]] = {}
        # Per pattern: each trip's first departure (trips are sorted by it)
        # and the longest any of its trips takes, to find the ones under way.
        self._starts = [[trip[2][0] for trip in trips] for trips in t.pattern_trips]
        self._longest = [max((trip[1][-1] - trip[2][0] for trip in trips), default=0) for trips in t.pattern_trips]
        self._city_patterns: dict[str, list[int]] = {}
        for pattern, stops in enumerate(t.pattern_stops):
            city = t.stop_city[stops[0]] if stops and t.stop_city else "Vilnius"
            self._city_patterns.setdefault(city, []).append(pattern)

    def start(self) -> None:
        """Tells the app every TICK_S that the buses have moved."""
        if self.polling:
            return
        self.polling = True

        def tick():
            while True:
                time.sleep(TICK_S)
                self._changed()

        threading.Thread(target=tick, daemon=True).start()

    def set_delay(self, pattern: int, trip: int, seconds: int) -> None:
        """Makes one trip run `seconds` late (0 puts it back on time)."""
        with self.lock:
            if seconds:
                self.delays[(pattern, trip)] = seconds
            else:
                self.delays.pop((pattern, trip), None)
            self._cache.clear()
        self._changed()

    def clear_delays(self) -> None:
        """Every bus back on time, for the next run of the demo."""
        with self.lock:
            self.delays.clear()
            self._cache.clear()
        self._changed()

    def cancelled_trips(self) -> set[tuple[int, int]]:
        return set()

    def _refresh_cancelled(self, city: str) -> None:
        pass

    def _snapshot(self, city: str):
        if city not in FEEDS:
            return None
        now = self.clock()
        key = int(now.timestamp())
        with self.lock:
            cached = self._cache.get(city)
            if cached and cached[0] == key:
                return cached[1]
        snapshot = self._build(city, now)
        with self.lock:
            self._cache[city] = (key, snapshot)
        return snapshot

    def _build(self, city: str, now: datetime) -> dict:
        t = self.t
        streets = shapes.of(t)
        clock_s = clock_seconds(now) + now.microsecond / 1e6
        days = []
        for back in (0, 1):     # today's trips, and yesterday's running past midnight
            day = now - timedelta(days=back)
            days.append((day.year * 10_000 + day.month * 100 + day.day, day.weekday(), clock_s + back * 86_400))
        # Position measured "now" on the real clock: the app moves a bus on
        # by the age of its fix, measured against its own (real) clock.
        measured = time.time()
        vehicles, by_trip = [], {}
        for pattern in self._city_patterns.get(city, []):
            trips = t.pattern_trips[pattern]
            if not trips:
                continue
            route = t.routes[t.pattern_route[pattern]]
            for date, weekday, at_s in days:
                # Trips that left at most `longest` (+ any delay) ago.
                last = bisect_right(self._starts[pattern], at_s)
                first = bisect_right(self._starts[pattern], at_s - self._longest[pattern] - 1800)
                for index in range(first, last):
                    service, arrivals, departures = trips[index]
                    if not t.runs(service, date, weekday):
                        continue
                    delay = self.delays.get((pattern, index), 0)
                    place = self._place(pattern, arrivals, departures, at_s - delay, streets)
                    if place is None:
                        continue
                    lat, lon, along, speed, bearing = place
                    vehicle = Vehicle(city=city, route=route.short_name,
                                      trolleybus=route.category == "trolleybus",
                                      lat=lat, lon=lon, bearing=bearing, delay=delay,
                                      trip=(pattern, index), headsign=t.pattern_headsign[pattern] or "",
                                      number=f"D{pattern}-{index}", measured=measured, speed=speed, along=along)
                    vehicles.append(vehicle)
                    by_trip[(pattern, index)] = vehicle
        return {"checked": time.monotonic(), "vehicles": vehicles, "by_trip": by_trip}

    def _place(self, pattern, arrivals, departures, at_s, streets):
        """(lat, lon, metres along, m/s, bearing) of a trip at `at_s`, or
        None when it has not left its first stop or has reached its last."""
        if at_s < departures[0] or at_s >= arrivals[-1]:
            return None
        # The last stop it has left.
        j = bisect_right(departures, at_s) - 1
        stops = self.t.pattern_stops[pattern]
        shape = streets.get(pattern)
        if at_s >= arrivals[j + 1]:
            # Standing at the next stop until it leaves (j + 1 has not departed).
            a, b, f, speed = j + 1, j + 1, 0.0, 0.0
        else:
            span = max(1.0, arrivals[j + 1] - departures[j])
            a, b, f = j, j + 1, (at_s - departures[j]) / span
            speed = None
        if shape is not None and len(shape.stop_m) == len(stops):
            m_a, m_b = shape.stop_m[a], shape.stop_m[b]
            along = m_a + (m_b - m_a) * f
            if speed is None:
                speed = max(0.0, (m_b - m_a) / max(1.0, arrivals[j + 1] - departures[j]))
            lat, lon = shape.point_at(along)
            ahead_lat, ahead_lon = shape.point_at(along + 8)
            behind_lat, behind_lon = shape.point_at(along - 8)
            bearing = _bearing(behind_lat, behind_lon, ahead_lat, ahead_lon)
            return lat, lon, along, round(speed, 2), bearing
        # No street: straight between the two stops.
        lat_a, lon_a = self.t.stop_lat[stops[a]], self.t.stop_lon[stops[a]]
        lat_b, lon_b = self.t.stop_lat[stops[b]], self.t.stop_lon[stops[b]]
        lat, lon = lat_a + (lat_b - lat_a) * f, lon_a + (lon_b - lon_a) * f
        return lat, lon, None, 0.0, _bearing(lat_a, lon_a, lat_b, lon_b) if a != b else None


def _bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> int | None:
    dy = (lat2 - lat1) * 110_540
    dx = (lon2 - lon1) * 111_320 * math.cos(math.radians(lat1))
    if abs(dx) + abs(dy) < 0.5:
        return None
    return round(math.degrees(math.atan2(dx, dy))) % 360
