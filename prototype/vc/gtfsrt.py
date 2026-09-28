"""GTFS Realtime, read with the standard library.

stops.lt publishes each city's realtime feed as GTFS-Realtime protobuf too
(checked 2026-09-27; not linked from anywhere, found by its standard name):

  vilnius/gtfs_realtime.pb    trip updates (one delay per trip) and vehicles
  kaunas/gtfs_realtime.pb     trip updates only
  klaipeda/trip_updates.pb    trip updates (its gtfs_realtime.pb: vehicles)

What it adds to gps_full.txt is the trips that will not run: a trip update
whose schedule_relationship is CANCELED (Vilnius had two that evening, on
line 46). Positions are the same fixes as gps_full.txt (0.1 m apart for the
same trip and second) but published half as often, every ~10 s against ~5 s,
so the app keeps taking positions from gps_full.txt.

Only the fields read here are decoded; the rest of each message is skipped
by its wire type, as protobuf intends.
"""

from __future__ import annotations

import struct

CANCELED = 3
_RELATIONSHIPS = {0: "SCHEDULED", 1: "ADDED", 2: "UNSCHEDULED", 3: "CANCELED", 5: "REPLACEMENT",
                  6: "DUPLICATED", 7: "DELETED"}


def _varint(buf: bytes, i: int) -> tuple[int, int]:
    value = shift = 0
    while True:
        byte = buf[i]
        i += 1
        value |= (byte & 0x7F) << shift
        if byte < 0x80:
            return value, i
        shift += 7


def _fields(buf: bytes):
    """(field number, value) for every field of one message: an int for
    varints and fixed-width numbers (as raw bits), bytes for the rest."""
    i, end = 0, len(buf)
    while i < end:
        key, i = _varint(buf, i)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, i = _varint(buf, i)
        elif wire == 1:
            value, i = struct.unpack_from("<Q", buf, i)[0], i + 8
        elif wire == 2:
            size, i = _varint(buf, i)
            value, i = buf[i:i + size], i + size
        elif wire == 5:
            value, i = struct.unpack_from("<I", buf, i)[0], i + 4
        else:
            raise ValueError(f"unsupported wire type {wire}")
        yield number, value


def _signed(value: int) -> int:
    """int32/int64 as protobuf writes them: two's complement in 64 bits."""
    return value - (1 << 64) if value >= 1 << 63 else value


def _float(bits: int) -> float:
    return struct.unpack("<f", struct.pack("<I", bits))[0]


def _trip(buf: bytes) -> dict:
    trip = {"trip_id": "", "relationship": "SCHEDULED"}
    for number, value in _fields(buf):
        if number == 1:
            trip["trip_id"] = value.decode("utf-8", "replace")
        elif number == 4:
            trip["relationship"] = _RELATIONSHIPS.get(value, str(value))
    return trip


def _trip_update(buf: bytes) -> dict:
    out = {"delay": None, "stop_id": None}
    for number, value in _fields(buf):
        if number == 1:
            out.update(_trip(value))
        elif number == 2 and out["delay"] is None:      # the first stop time update
            for n, v in _fields(value):
                if n == 4:
                    out["stop_id"] = v.decode("utf-8", "replace")
                elif n in (2, 3):                        # arrival / departure
                    for m, w in _fields(v):
                        if m == 1:
                            out["delay"] = _signed(w)
        elif number == 5:                                # TripUpdate.delay
            out["delay"] = _signed(value)
    return out


def _vehicle(buf: bytes) -> dict:
    out = {"trip_id": "", "id": "", "label": "", "lat": None, "lon": None, "bearing": None, "speed": None,
           "timestamp": None, "stop_id": None, "status": 2, "wheelchair": 0}
    for number, value in _fields(buf):
        if number == 1:
            out["trip_id"] = _trip(value)["trip_id"]
        elif number == 2:
            for n, v in _fields(value):
                if n in (1, 2, 3, 5):
                    out[{1: "lat", 2: "lon", 3: "bearing", 5: "speed"}[n]] = _float(v)
        elif number == 4:
            out["status"] = value
        elif number == 5:
            out["timestamp"] = value
        elif number == 7:
            out["stop_id"] = value.decode("utf-8", "replace")
        elif number == 8:
            for n, v in _fields(value):
                if n == 1:
                    out["id"] = v.decode("utf-8", "replace")
                elif n == 2:
                    out["label"] = v.decode("utf-8", "replace")
                elif n == 4:
                    out["wheelchair"] = v
    return out


def parse(buf: bytes) -> dict:
    """{"timestamp": s, "trips": [...], "vehicles": [...]} from a FeedMessage.
    A trip: {"trip_id", "relationship", "delay" (s, + late), "stop_id"}.
    A vehicle: {"trip_id", "id", "label", "lat", "lon", "bearing", "speed"
    (m/s), "timestamp" (s), "stop_id", "status" (1 = at the stop),
    "wheelchair" (2 = accessible)}."""
    feed = {"timestamp": None, "trips": [], "vehicles": []}
    for number, value in _fields(buf):
        if number == 1:
            for n, v in _fields(value):
                if n == 3:
                    feed["timestamp"] = v
        elif number == 2:
            for n, v in _fields(value):
                if n == 3:
                    feed["trips"].append(_trip_update(v))
                elif n == 4:
                    feed["vehicles"].append(_vehicle(v))
    return feed


def cancelled(feed: dict) -> set[str]:
    """The ids of the trips the feed says will not run."""
    return {trip["trip_id"] for trip in feed["trips"] if trip["relationship"] == "CANCELED" and trip["trip_id"]}
