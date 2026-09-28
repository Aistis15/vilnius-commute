"""What leaves soon from the stops around a point.

The board at the stop, for every stop within a short walk: grouped by stop
name (the platforms on both sides of a street share it), then by line and
direction, soonest first. Live where the vehicle is on the road: its delay
moves the time, and the row says so.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from .data import Timetable
from .planner import _base_name, route_json, service_day, walk_m

RADIUS_M = 600          # about seven minutes on foot
HORIZON_S = 3600        # the next hour
PER_LINE = 3            # times shown per line and direction
LINES_PER_STOP = 8


def _clock(midnight: datetime, seconds: int) -> dict:
    moment = midnight + timedelta(seconds=seconds)
    return {"iso": moment.isoformat(timespec="seconds"), "hm": moment.strftime("%H:%M")}


def nearby(t: Timetable, lat: float, lon: float, when: datetime, live=None,
           max_stops: int = 4, radius_m: int = RADIUS_M) -> dict:
    """Departures in the next hour from the `max_stops` nearest stops.

    `live` is a vc.live.Live, or None when `when` is not the real now (the
    prototype's clock can run ahead): live delays only mean something now.
    """
    midnight = when.replace(hour=0, minute=0, second=0, microsecond=0)
    now_s = int((when - midnight).total_seconds())
    days = ((service_day(midnight), 0), (service_day(midnight - timedelta(days=1)), -86_400))

    found = []
    for stop, (slat, slon) in enumerate(zip(t.stop_lat, t.stop_lon)):
        if abs(slat - lat) > 0.01 or abs(slon - lon) > 0.016:
            continue
        metres = walk_m(lat, lon, slat, slon)
        if metres <= radius_m and t.patterns_at_stop[stop]:
            found.append((metres, stop))
    found.sort()

    groups: dict[str, dict] = {}
    for metres, stop in found:
        name = _base_name(t.stop_names[stop])
        if name not in groups:
            if len(groups) >= max_stops:
                continue
            groups[name] = {"name": name, "metres": metres, "lat": t.stop_lat[stop],
                            "lon": t.stop_lon[stop], "platforms": []}
        groups[name]["platforms"].append(stop)

    out = []
    for group in groups.values():
        ordered = _lines_at(t, group["platforms"], midnight, now_s, days, live)
        out.append({
            "name": group["name"],
            "metres": group["metres"],
            "lat": group["lat"],
            "lon": group["lon"],
            "city": t.stop_city[group["platforms"][0]] if t.stop_city else "Vilnius",
            "lines": ordered[:LINES_PER_STOP],
            "live": any(d["live"] for l in ordered for d in l["departures"]),
        })
    return {"stops": out, "live_available": live is not None}


def _lines_at(t: Timetable, platforms: list[int], midnight: datetime, now_s: int, days, live) -> list[dict]:
    """The lines leaving these platforms in the next hour, soonest first. A
    trip called off today stays on the board, marked: the bus someone waits
    for is still there, saying it will not come."""
    lines: dict[tuple[int, str], dict] = {}
    cancelled = live.cancelled_trips() if live is not None else set()
    for stop in platforms:
        for pattern, index in t.patterns_at_stop[stop]:
            stops = t.pattern_stops[pattern]
            if index == len(stops) - 1:
                continue  # the line ends here: it takes nobody away
            headsign = t.pattern_headsign[pattern] or t.stop_names[stops[-1]]
            for trip, (service, _arrivals, departures) in enumerate(t.pattern_trips[pattern]):
                for (date, weekday), shift in days:
                    scheduled = departures[index] + shift
                    if not now_s - 900 <= scheduled <= now_s + HORIZON_S:
                        continue
                    if not t.runs(service, date, weekday):
                        continue
                    off = shift == 0 and (pattern, trip) in cancelled
                    vehicle = live.vehicle_on(pattern, trip) if live is not None and not off else None
                    delay = vehicle.delay if vehicle is not None else None
                    expected = scheduled + (delay or 0)
                    if expected < now_s - 30 or expected > now_s + HORIZON_S:
                        continue
                    key = (t.pattern_route[pattern], headsign)
                    line = lines.setdefault(key, {"route": route_json(t, pattern),
                                                  "headsign": headsign, "departures": []})
                    line["departures"].append({
                        **_clock(midnight, expected),
                        "scheduled": _clock(midnight, scheduled)["hm"],
                        "delay_s": delay,
                        "live": delay is not None,
                        "cancelled": off,
                    })
    for line in lines.values():
        line["departures"].sort(key=lambda d: d["iso"])
        kept, running = [], 0
        for departure in line["departures"]:
            if running == PER_LINE:
                break
            kept.append(departure)
            running += not departure["cancelled"]
        line["departures"] = kept
    # In the order of their next time, called off or not: a line whose next
    # bus will not come is news, not something to push down the board.
    return sorted(lines.values(), key=lambda l: l["departures"][0]["iso"])


def at_stop(t: Timetable, stop: int, when: datetime, live=None) -> dict:
    """The board of one platform, for the map's stop card. One platform, not
    the name's group: the one tapped faces one way."""
    midnight = when.replace(hour=0, minute=0, second=0, microsecond=0)
    now_s = int((when - midnight).total_seconds())
    days = ((service_day(midnight), 0), (service_day(midnight - timedelta(days=1)), -86_400))
    lines = _lines_at(t, [stop], midnight, now_s, days, live)
    return {"id": stop, "name": t.stop_names[stop], "lat": t.stop_lat[stop], "lon": t.stop_lon[stop],
            "lines": lines[:LINES_PER_STOP], "live": any(d["live"] for l in lines for d in l["departures"]),
            "live_available": live is not None}


# A map zoomed out to half a city would draw thousands of stops; past this
# span it shows none and says to zoom in.
MAX_BOX_DEG = 0.05


def in_box(t: Timetable, south: float, west: float, north: float, east: float, limit: int = 600) -> dict:
    """The stops inside a map view that anything leaves from."""
    if north - south > MAX_BOX_DEG or east - west > MAX_BOX_DEG * 1.8:
        return {"stops": [], "too_wide": True}
    stops = [{"id": i, "name": t.stop_names[i], "lat": lat, "lon": lon}
             for i, (lat, lon) in enumerate(zip(t.stop_lat, t.stop_lon))
             if south <= lat <= north and west <= lon <= east and t.patterns_at_stop[i]]
    return {"stops": stops[:limit], "too_wide": False}
