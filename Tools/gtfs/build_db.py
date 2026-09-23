#!/usr/bin/env python3
"""Turn the Vilnius GTFS feed into a compact SQLite database for on-device routing.

Runs in CI, never on the phone: the feed is a 3.7 MB zip that expands to ~34 MB
of CSV, and parsing it on an iPhone every launch would be wasteful and slow.

The schema is shaped for RAPTOR rather than for GTFS. The important difference
is `pattern`: RAPTOR's notion of a "route" is a set of trips that visit an
identical ordered list of stops, which is not the same as a GTFS `route_id`.
The live feed has 115 GTFS routes but 691 distinct patterns, so the distinction
is load-bearing.

Three properties of this feed drive the design, all verified rather than
assumed — see docs/data-formats.md:

1. Times run past 24:00:00 (the feed reaches 30:11:00). They are stored as
   seconds from the service day's midnight and may exceed 86 400. Parsing them
   into a wall clock loses the night network.
2. Stops are flat — no parent_station, no location_type. Nothing says which
   stops are the same place.
3. There is no transfers.txt, so foot transfers are derived here by proximity.

Usage:
    build_db.py <gtfs.zip | extracted-dir> <out.sqlite> [--max-transfer-m 400]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import math
import sqlite3
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

# route_id prefix -> the category the UI draws. Kept in step with
# TransitCategory.from(routeID:) in Core.
CATEGORY_BY_PREFIX = {
    "vilnius_bus": "bus",
    "vilnius_expressbus": "expressBus",
    "vilnius_nightbus": "nightBus",
    "vilnius_trol": "trolleybus",
    "vilnius_ferry": "ferry",
}

SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE stop (
    id       INTEGER PRIMARY KEY,   -- dense 0..n-1, so RAPTOR can index arrays
    gtfs_id  TEXT NOT NULL UNIQUE,
    name     TEXT NOT NULL,
    lat      REAL NOT NULL,
    lon      REAL NOT NULL
);

CREATE TABLE route (
    id          INTEGER PRIMARY KEY,
    gtfs_id     TEXT NOT NULL UNIQUE,
    short_name  TEXT NOT NULL,
    long_name   TEXT,
    category    TEXT NOT NULL,      -- matches Core.TransitCategory
    route_type  INTEGER NOT NULL,
    color       TEXT,               -- six hex digits, no '#'
    text_color  TEXT
);

-- A RAPTOR route: trips sharing one identical ordered stop list.
CREATE TABLE pattern (
    id           INTEGER PRIMARY KEY,
    route_id     INTEGER NOT NULL REFERENCES route(id),
    headsign     TEXT,
    direction_id INTEGER,
    num_stops    INTEGER NOT NULL
);

CREATE TABLE pattern_stop (
    pattern_id INTEGER NOT NULL REFERENCES pattern(id),
    seq        INTEGER NOT NULL,    -- 0-based position along the pattern
    stop_id    INTEGER NOT NULL REFERENCES stop(id),
    PRIMARY KEY (pattern_id, seq)
) WITHOUT ROWID;

CREATE TABLE service (
    id         INTEGER PRIMARY KEY,
    gtfs_id    TEXT NOT NULL UNIQUE,
    weekdays   INTEGER NOT NULL,    -- bitmask, bit 0 = Monday .. bit 6 = Sunday
    start_date INTEGER NOT NULL,    -- yyyymmdd
    end_date   INTEGER NOT NULL
);

CREATE TABLE service_exception (
    service_id INTEGER NOT NULL REFERENCES service(id),
    date       INTEGER NOT NULL,    -- yyyymmdd
    added      INTEGER NOT NULL,    -- 1 = service added, 0 = removed
    PRIMARY KEY (service_id, date)
) WITHOUT ROWID;

CREATE TABLE trip (
    id         INTEGER PRIMARY KEY,
    pattern_id INTEGER NOT NULL REFERENCES pattern(id),
    service_id INTEGER NOT NULL REFERENCES service(id),
    gtfs_id    TEXT NOT NULL,
    departure  INTEGER NOT NULL     -- first stop's departure, for ordering
);

-- Seconds from the service day's midnight. MAY EXCEED 86400 - see module docs.
CREATE TABLE trip_time (
    trip_id   INTEGER NOT NULL REFERENCES trip(id),
    seq       INTEGER NOT NULL,
    arrival   INTEGER NOT NULL,
    departure INTEGER NOT NULL,
    PRIMARY KEY (trip_id, seq)
) WITHOUT ROWID;

-- Derived here: the feed ships no transfers.txt.
CREATE TABLE transfer (
    from_stop INTEGER NOT NULL REFERENCES stop(id),
    to_stop   INTEGER NOT NULL REFERENCES stop(id),
    meters    INTEGER NOT NULL,     -- distance only; walking speed is a user setting
    PRIMARY KEY (from_stop, to_stop)
) WITHOUT ROWID;
"""

INDEXES = """
-- RAPTOR's hot lookup: which patterns serve this stop, and at what position.
CREATE INDEX idx_pattern_stop_stop ON pattern_stop(stop_id, pattern_id, seq);
-- Scanning a pattern in departure order.
CREATE INDEX idx_trip_pattern ON trip(pattern_id, departure);
CREATE INDEX idx_trip_service ON trip(service_id);
CREATE INDEX idx_transfer_from ON transfer(from_stop, meters);
CREATE INDEX idx_stop_name ON stop(name);
"""


def parse_time(value: str) -> int:
    """`HH:MM:SS` -> seconds from the service day's midnight.

    Hours past 24 are legal and meaningful: `30:11:00` is 06:11 the following
    morning, still part of the previous service day. The feed really does
    contain those, so this must not wrap.
    """
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds)


def category_for(route_id: str) -> str:
    prefix = route_id.rsplit("_", 1)[0] if "_" in route_id else ""
    return CATEGORY_BY_PREFIX.get(prefix, "other")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    radius = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


class Feed:
    """Reads the GTFS CSVs out of a zip or a directory."""

    def __init__(self, source: Path):
        self.source = source
        self.zip = zipfile.ZipFile(source) if source.is_file() else None

    def rows(self, name: str):
        if self.zip is not None:
            with self.zip.open(name) as raw:
                text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
                yield from csv.DictReader(text)
        else:
            with open(self.source / name, encoding="utf-8-sig", newline="") as f:
                yield from csv.DictReader(f)

    def has(self, name: str) -> bool:
        if self.zip is not None:
            return name in self.zip.namelist()
        return (self.source / name).exists()

    def digest(self) -> str:
        """Hash of the source, so the app can tell builds apart."""
        if self.zip is not None:
            return hashlib.sha256(self.source.read_bytes()).hexdigest()[:16]
        parts = sorted(p.name for p in self.source.glob("*.txt"))
        h = hashlib.sha256()
        for name in parts:
            h.update((self.source / name).read_bytes())
        return h.hexdigest()[:16]


def build(feed: Feed, db: sqlite3.Connection, max_transfer_m: int) -> dict:
    db.executescript(SCHEMA)
    stats: dict[str, int] = {}

    # --- stops -------------------------------------------------------------
    stop_index: dict[str, int] = {}
    stop_rows = []
    coords = []
    for row in feed.rows("stops.txt"):
        index = len(stop_index)
        stop_index[row["stop_id"]] = index
        lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
        stop_rows.append((index, row["stop_id"], row["stop_name"].strip(), lat, lon))
        coords.append((lat, lon))
    db.executemany("INSERT INTO stop VALUES (?,?,?,?,?)", stop_rows)
    stats["stops"] = len(stop_rows)

    # --- routes ------------------------------------------------------------
    route_index: dict[str, int] = {}
    route_rows = []
    for row in feed.rows("routes.txt"):
        index = len(route_index)
        route_index[row["route_id"]] = index
        route_rows.append((
            index,
            row["route_id"],
            row["route_short_name"].strip(),
            (row.get("route_long_name") or "").strip() or None,
            category_for(row["route_id"]),
            int(row["route_type"]),
            (row.get("route_color") or "").strip().upper() or None,
            (row.get("route_text_color") or "").strip().upper() or None,
        ))
    db.executemany("INSERT INTO route VALUES (?,?,?,?,?,?,?,?)", route_rows)
    stats["routes"] = len(route_rows)

    # --- services ----------------------------------------------------------
    service_index: dict[str, int] = {}
    service_rows = []
    DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
    for row in feed.rows("calendar.txt"):
        index = len(service_index)
        service_index[row["service_id"]] = index
        mask = 0
        for bit, day in enumerate(DAYS):
            if row[day] == "1":
                mask |= 1 << bit
        service_rows.append((index, row["service_id"], mask,
                             int(row["start_date"]), int(row["end_date"])))
    db.executemany("INSERT INTO service VALUES (?,?,?,?,?)", service_rows)
    stats["services"] = len(service_rows)

    if feed.has("calendar_dates.txt"):
        exceptions = []
        for row in feed.rows("calendar_dates.txt"):
            sid = row["service_id"]
            if sid not in service_index:
                # A service that appears only as an exception still needs a row,
                # or its trips reference nothing.
                index = len(service_index)
                service_index[sid] = index
                db.execute("INSERT INTO service VALUES (?,?,?,?,?)",
                           (index, sid, 0, 0, 99999999))
            exceptions.append((service_index[sid], int(row["date"]),
                               1 if row["exception_type"] == "1" else 0))
        db.executemany("INSERT OR REPLACE INTO service_exception VALUES (?,?,?)", exceptions)
        stats["service_exceptions"] = len(exceptions)

    # --- trips and their stop sequences ------------------------------------
    trip_meta = {}
    for row in feed.rows("trips.txt"):
        trip_meta[row["trip_id"]] = row

    sequences: dict[str, list[tuple[int, str, int, int]]] = defaultdict(list)
    for row in feed.rows("stop_times.txt"):
        sequences[row["trip_id"]].append((
            int(row["stop_sequence"]),
            row["stop_id"],
            parse_time(row["arrival_time"]),
            parse_time(row["departure_time"]),
        ))

    # Group trips into patterns by their ordered stop list.
    pattern_index: dict[tuple, int] = {}
    pattern_rows = []
    pattern_stop_rows = []
    trip_rows = []
    trip_time_rows = []

    for trip_id in sorted(sequences):            # sorted for reproducible ids
        stops = sorted(sequences[trip_id])
        meta = trip_meta.get(trip_id)
        if meta is None or len(stops) < 2:
            continue

        key = (meta["route_id"], tuple(s[1] for s in stops))
        if key not in pattern_index:
            pid = len(pattern_index)
            pattern_index[key] = pid
            pattern_rows.append((
                pid,
                route_index[meta["route_id"]],
                (meta.get("trip_headsign") or "").strip() or None,
                int(meta["direction_id"]) if meta.get("direction_id") not in (None, "") else None,
                len(stops),
            ))
            for seq, (_, gtfs_stop, _, _) in enumerate(stops):
                pattern_stop_rows.append((pid, seq, stop_index[gtfs_stop]))

        pid = pattern_index[key]
        tid = len(trip_rows)
        trip_rows.append((tid, pid, service_index[meta["service_id"]], trip_id, stops[0][3]))
        for seq, (_, _, arrival, departure) in enumerate(stops):
            trip_time_rows.append((tid, seq, arrival, departure))

    db.executemany("INSERT INTO pattern VALUES (?,?,?,?,?)", pattern_rows)
    db.executemany("INSERT INTO pattern_stop VALUES (?,?,?)", pattern_stop_rows)
    db.executemany("INSERT INTO trip VALUES (?,?,?,?,?)", trip_rows)
    db.executemany("INSERT INTO trip_time VALUES (?,?,?,?)", trip_time_rows)
    stats["patterns"] = len(pattern_rows)
    stats["trips"] = len(trip_rows)
    stats["stop_times"] = len(trip_time_rows)
    stats["max_departure_s"] = max((t[3] for t in trip_time_rows), default=0)

    # --- derived foot transfers -------------------------------------------
    # The feed has no transfers.txt and no parent_station, so walkable pairs
    # are found geometrically. A grid keyed on ~max_transfer_m cells keeps this
    # linear instead of comparing all 1.2M stop pairs.
    cell = max_transfer_m / 111_320.0            # degrees latitude per metre
    grid: dict[tuple[int, int], list[int]] = defaultdict(list)
    for index, (lat, lon) in enumerate(coords):
        grid[(int(lat / cell), int(lon / cell))].append(index)

    transfers = []
    for index, (lat, lon) in enumerate(coords):
        gy, gx = int(lat / cell), int(lon / cell)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                for other in grid.get((gy + dy, gx + dx), ()):
                    if other == index:
                        continue
                    distance = haversine_m(lat, lon, coords[other][0], coords[other][1])
                    if distance <= max_transfer_m:
                        transfers.append((index, other, round(distance)))
    db.executemany("INSERT OR REPLACE INTO transfer VALUES (?,?,?)", transfers)
    stats["transfers"] = len(transfers)

    # --- metadata and indexes ---------------------------------------------
    db.executemany("INSERT INTO meta VALUES (?,?)", [
        ("schema_version", "1"),
        ("feed_digest", feed.digest()),
        ("max_transfer_m", str(max_transfer_m)),
        ("stops", str(stats["stops"])),
        ("patterns", str(stats["patterns"])),
        ("trips", str(stats["trips"])),
    ])
    db.executescript(INDEXES)
    db.commit()
    db.execute("VACUUM")
    db.commit()
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="gtfs.zip or an extracted directory")
    parser.add_argument("output", type=Path, help="SQLite file to write")
    parser.add_argument("--max-transfer-m", type=int, default=400,
                        help="furthest walkable stop-to-stop transfer, metres")
    args = parser.parse_args()

    if args.output.exists():
        args.output.unlink()
    args.output.parent.mkdir(parents=True, exist_ok=True)

    feed = Feed(args.source)
    with sqlite3.connect(args.output) as db:
        stats = build(feed, db, args.max_transfer_m)

    size = args.output.stat().st_size
    print(f"wrote {args.output} ({size/1e6:.1f} MB)")
    for key in ("stops", "routes", "services", "service_exceptions",
                "patterns", "trips", "stop_times", "transfers", "max_departure_s"):
        if key in stats:
            print(f"  {key:20} {stats[key]:>10,}")

    # A feed whose latest departure does not pass midnight means the times were
    # parsed wrong and the night network is gone.
    if stats.get("max_departure_s", 0) <= 86_400:
        print("\nWARNING: no departures past 24:00:00 - after-midnight service "
              "may have been parsed incorrectly", file=sys.stderr)


if __name__ == "__main__":
    main()
