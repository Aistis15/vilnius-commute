"""Walking directions along the streets: the path and every turn on it.

OpenStreetMap's foot router, OSRM on routing.openstreetmap.de, run by FOSSGIS
as a volunteer service for light use (checked 2026-09-27: the foot instance
answers /routed-foot/route/v1/driving/<from>;<to> with the path and each
maneuver's bearings). The prototype asks once per walk of a trip it starts
and keeps the answer. On the iPhone, MapKit's walking directions do this.

A turn is kept as its real angle, not a category: the banner draws the arrow
bent by exactly that much, as the street does.
"""

from __future__ import annotations

import json
import math
import threading
import urllib.request

from .data import USER_AGENT

URL = ("https://routing.openstreetmap.de/routed-foot/route/v1/driving/{a};{b}"
       "?overview=full&geometries=geojson&steps=true")

# A "turn" onto a step shorter than this is the router tidying up the last
# few metres, not something to tell a person.
MIN_STEP_M = 8

_cache: dict[tuple, dict] = {}
_lock = threading.Lock()


def _metres(a: tuple[float, float], b: tuple[float, float]) -> float:
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6_371_000 * math.asin(min(1.0, math.sqrt(h)))


def turn_angle(before: float, after: float) -> float:
    """Degrees to turn, -180..180: negative left, positive right."""
    return (after - before + 540) % 360 - 180


def parse(data: dict) -> dict | None:
    """OSRM's answer as {"metres", "coords": [[lat, lon]], "along": [m],
    "turns": [{"at": m, "angle": deg, "name": str}]}. None if no route."""
    if data.get("code") != "Ok" or not data.get("routes"):
        return None
    route = data["routes"][0]
    coords = [[lat, lon] for lon, lat in route["geometry"]["coordinates"]]
    if len(coords) < 2:
        return None
    along = [0.0]
    for a, b in zip(coords, coords[1:]):
        along.append(along[-1] + _metres(tuple(a), tuple(b)))

    steps = [step for leg in route.get("legs", []) for step in leg.get("steps", [])]
    turns, at = [], 0.0
    for index, step in enumerate(steps):
        maneuver = step.get("maneuver", {})
        kind = maneuver.get("type")
        last = index == len(steps) - 1 or steps[index + 1].get("maneuver", {}).get("type") == "arrive"
        if kind not in ("depart", "arrive") and (step.get("distance", 0) >= MIN_STEP_M or not last):
            angle = turn_angle(maneuver.get("bearing_before", 0), maneuver.get("bearing_after", 0))
            turns.append({"at": round(at, 1), "angle": round(angle), "name": step.get("name") or ""})
        at += step.get("distance", 0)
    # The router's distances and the path's own may differ by a metre or two;
    # the path is what the position is measured on.
    scale = along[-1] / at if at else 1.0
    for turn in turns:
        turn["at"] = round(turn["at"] * scale, 1)
    return {"metres": round(along[-1], 1), "coords": coords, "along": [round(x, 1) for x in along], "turns": turns}


def _fetch(lat1: float, lon1: float, lat2: float, lon2: float) -> dict:
    url = URL.format(a=f"{lon1:.6f},{lat1:.6f}", b=f"{lon2:.6f},{lat2:.6f}")
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read())


def route(lat1: float, lon1: float, lat2: float, lon2: float, fetch=_fetch) -> dict | None:
    """The walking path between two points, or None (offline, no path)."""
    key = (round(lat1, 5), round(lon1, 5), round(lat2, 5), round(lon2, 5))
    with _lock:
        if key in _cache:
            return _cache[key]
    try:
        found = parse(fetch(lat1, lon1, lat2, lon2))
    except Exception:  # noqa: BLE001 - no directions is a normal state
        return None
    with _lock:
        _cache[key] = found
    return found
