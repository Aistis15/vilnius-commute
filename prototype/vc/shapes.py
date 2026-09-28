"""The streets a line drives, from the feed's shapes (see Tools/gtfs/build_db.py).

A ride is drawn along its street instead of straight from stop to stop, and
a live bus is placed on its street and moved along it. Distances are metres
along the shape; each stop of the pattern is placed on it once, going
forward, so a line that passes the same corner twice keeps its order.

Decoded only when a pattern is first needed, and kept: a session touches a
few dozen of the 1 184 patterns.
"""

from __future__ import annotations

import math
import threading
from bisect import bisect_right
from dataclasses import dataclass

# A stop is placed on the first stretch of the line that passes within this;
# failing that, on the nearest stretch ahead.
STOP_REACH_M = 35
# A vehicle further than this from its line is off it (a diversion): it is
# drawn where it says it is, not pulled onto the line.
SNAP_M = 40


def decode(polyline: str) -> list[tuple[float, float]]:
    """Google's encoded polyline, 1e-5 degrees."""
    points, index, lat, lon = [], 0, 0, 0
    while index < len(polyline):
        for axis in (0, 1):
            shift = result = 0
            while True:
                byte = ord(polyline[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lon += delta
        points.append((lat / 1e5, lon / 1e5))
    return points


def _xy(lat: float, lon: float, lat0: float) -> tuple[float, float]:
    return lon * 111_320 * math.cos(math.radians(lat0)), lat * 110_540


@dataclass
class Shape:
    lat: list[float]
    lon: list[float]
    along: list[float]          # metres from the start, per point
    stop_m: list[float]         # metres from the start, per stop of the pattern

    @property
    def length(self) -> float:
        return self.along[-1]

    def _segment(self, i: int, lat: float, lon: float) -> tuple[float, float]:
        """(distance to segment i, metres along the shape of the nearest point)."""
        lat0 = self.lat[i]
        ax, ay = _xy(self.lat[i], self.lon[i], lat0)
        bx, by = _xy(self.lat[i + 1], self.lon[i + 1], lat0)
        px, py = _xy(lat, lon, lat0)
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        f = 0.0 if length2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
        return math.hypot(px - (ax + f * dx), py - (ay + f * dy)), self.along[i] + f * (self.along[i + 1] - self.along[i])

    def locate(self, lat: float, lon: float, lo_m: float = 0.0, hi_m: float | None = None) -> tuple[float, float]:
        """The nearest point of the shape between lo_m and hi_m along it:
        (metres along, metres away)."""
        hi_m = self.length if hi_m is None else hi_m
        first = max(0, bisect_right(self.along, lo_m) - 1)
        last = min(len(self.along) - 2, bisect_right(self.along, hi_m))
        best = (math.inf, lo_m)
        for i in range(first, last + 1):
            d, m = self._segment(i, lat, lon)
            if d < best[0]:
                best = (d, m)
        return best[1], best[0]

    def point_at(self, m: float) -> tuple[float, float]:
        m = max(0.0, min(self.length, m))
        i = max(0, min(len(self.along) - 2, bisect_right(self.along, m) - 1))
        span = self.along[i + 1] - self.along[i]
        f = 0.0 if span == 0 else (m - self.along[i]) / span
        return (self.lat[i] + (self.lat[i + 1] - self.lat[i]) * f,
                self.lon[i] + (self.lon[i + 1] - self.lon[i]) * f)

    def cut(self, a_m: float, b_m: float) -> list[tuple[float, float]]:
        """The line from a_m to b_m along it, both ends included."""
        a_m, b_m = max(0.0, a_m), min(self.length, b_m)
        if b_m <= a_m:
            return [self.point_at(a_m)]
        inside = [(self.lat[i], self.lon[i]) for i in range(len(self.along)) if a_m < self.along[i] < b_m]
        return [self.point_at(a_m), *inside, self.point_at(b_m)]


def build(points: list[tuple[float, float]], stops: list[tuple[float, float]]) -> Shape:
    along = [0.0]
    for (lat1, lon1), (lat2, lon2) in zip(points, points[1:]):
        x1, y1 = _xy(lat1, lon1, lat1)
        x2, y2 = _xy(lat2, lon2, lat1)
        along.append(along[-1] + math.hypot(x2 - x1, y2 - y1))
    shape = Shape([p[0] for p in points], [p[1] for p in points], along, [])
    # Each stop on the first stretch ahead that passes close enough to it.
    at = 0.0
    for lat, lon in stops:
        first = max(0, bisect_right(along, at) - 1)
        placed = None
        best = (math.inf, at)
        for i in range(first, len(points) - 1):
            d, m = shape._segment(i, lat, lon)
            if m < at:
                m = at
            if d < best[0]:
                best = (d, m)
            if d <= STOP_REACH_M:
                placed = best
            elif placed is not None:
                break                   # left the first close stretch
        at = (placed or best)[1]
        shape.stop_m.append(at)
    return shape


def of(t) -> "Shapes":
    """The timetable's shapes, made once and kept with it."""
    found = getattr(t, "_shapes", None)
    if found is None:
        found = Shapes(t)
        t._shapes = found
    return found


class Shapes:
    """Each pattern's shape, decoded on first use."""

    def __init__(self, t):
        self.t = t
        self._cache: dict[int, Shape | None] = {}
        self._lock = threading.Lock()

    def get(self, pattern: int) -> Shape | None:
        with self._lock:
            if pattern in self._cache:
                return self._cache[pattern]
        encoded = self.t.pattern_polyline[pattern] if pattern < len(self.t.pattern_polyline) else None
        shape = None
        if encoded:
            points = decode(encoded)
            if len(points) >= 2:
                stops = [(self.t.stop_lat[s], self.t.stop_lon[s]) for s in self.t.pattern_stops[pattern]]
                shape = build(points, stops)
        with self._lock:
            self._cache[pattern] = shape
        return shape

    def ride(self, pattern: int, board: int, alight: int) -> dict | None:
        """The street from the stop boarded at to the stop got off at:
        {"coords": [[lat, lon]], "stops": metres along it of each stop}."""
        shape = self.get(pattern)
        if shape is None:
            return None
        start = shape.stop_m[board]
        return {"coords": [[round(lat, 5), round(lon, 5)] for lat, lon in shape.cut(start, shape.stop_m[alight])],
                "stops": [round(shape.stop_m[i] - start, 1) for i in range(board, alight + 1)]}

    def place(self, pattern: int, lat: float, lon: float, near_stop: int | None = None) -> float | None:
        """Metres along its line where a vehicle is; None when it is off the
        line. `near_stop`, the last stop it is thought to have left, keeps
        the search to that stretch (a line can pass one spot twice)."""
        shape = self.get(pattern)
        if shape is None:
            return None
        lo, hi = 0.0, None
        if near_stop is not None:
            k = max(0, min(len(shape.stop_m) - 1, near_stop))
            lo = shape.stop_m[max(0, k - 1)]
            hi = shape.stop_m[min(len(shape.stop_m) - 1, k + 2)]
        m, d = shape.locate(lat, lon, lo, hi)
        if d > SNAP_M and near_stop is not None:
            m, d = shape.locate(lat, lon)
        return m if d <= SNAP_M else None
