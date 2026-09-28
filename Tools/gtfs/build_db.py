#!/usr/bin/env python3
"""Turn the stops.lt GTFS feeds into one compact SQLite database for on-device routing.

Runs in CI, never on the phone: the Vilnius feed alone is a 3.6 MB zip that
expands to ~34 MB of CSV, and parsing it on an iPhone every launch would be
wasteful and slow.

Five cities publish the same GTFS shape on stops.lt; the product uses three,
Vilnius, Kaunas and Klaipėda, the ones with live vehicle data (the workflow's
CITIES decides which feeds come in). They are merged into one set of tables with dense
integer ids across all of them, so the router sees a single network. The
product plans trips inside each city, so the coaches between cities that the
Šiauliai feed also carries are left out (EXCLUDED_KINDS). The file
keeps its historical name, vilnius.sqlite, because the app and the release
asset already use it.

The schema is shaped for RAPTOR rather than for GTFS. The important difference
is `pattern`: RAPTOR's notion of a "route" is a set of trips that visit an
identical ordered list of stops, which is not the same as a GTFS `route_id`.
The Vilnius feed has 115 GTFS routes but ~690 distinct patterns, so the
distinction is load-bearing.

Four properties of these feeds drive the design, all verified rather than
assumed (see docs/data-formats.md):

1. Times run past 24:00:00 (Vilnius reaches 30:11:00). They are stored as
   seconds from the service day's midnight and may exceed 86 400. Parsing them
   into a wall clock loses the night network.
2. Stops are flat: no parent_station, no location_type. Nothing says which
   stops are the same place.
3. No feed has a transfers.txt, so foot transfers are derived here by
   proximity, across feeds too. That is how a Šiauliai intercity bus that ends
   at Vilnius bus station meets the Vilnius city buses.
4. Stop, service and trip ids repeat between feeds (stop 5118 exists in three
   of them), so those are namespaced as `<city>:<id>`. Route ids already carry
   the city (`kaunas_bus_3`) and are kept verbatim.

Every feed also ships shapes.txt, the streets its vehicles drive (checked
2026-09-28: Vilnius 142 214 points, Kaunas 89 436, Klaipėda 38 371). Each
pattern keeps the shape most of its trips use, thinned to within
SHAPE_TOLERANCE_M of the original and written as an encoded polyline: the
app draws rides along the street with it instead of straight from stop to
stop through the buildings, and moves live buses along it.

Usage:
    build_db.py --feed vilnius=v.zip --feed kaunas=k.zip ... <out.sqlite>
    build_db.py <gtfs.zip | extracted-dir> <out.sqlite>    # Vilnius only
    [--max-transfer-m 400]
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import sqlite3
import sys
import zipfile
from collections import defaultdict
from pathlib import Path

# stops.lt path segment -> the name people read. The slug is also the
# route_id prefix and the namespace for stop, service and trip ids.
CITY_NAMES = {
    "vilnius": "Vilnius",
    "kaunas": "Kaunas",
    "klaipeda": "Klaipėda",
    "siauliai": "Šiauliai",
    "panevezys": "Panevėžys",
}

# The kind token of `<city>_<kind>_<name>` -> the category the UI draws.
# Existing strings must not change: they are Core.TransitCategory raw values.
# TransitCategory.from(routeID:) in Core still knows only Vilnius prefixes, but
# nothing on the load path uses it: the app reads route.category from here.
CATEGORY_BY_KIND = {
    "bus": "bus",
    "expressbus": "expressBus",
    "nightbus": "nightBus",
    "trol": "trolleybus",
    "ferry": "ferry",
    # Šiauliai's minibus and regional lines are route_type 3 buses with their
    # own colours in the feed, so "bus" loses nothing.
    "minibus": "bus",
    "regionalbus": "bus",
}

# Kinds left out of the database. The product plans trips inside the five
# cities; Šiauliai's feed also carries coaches to Vilnius and Kaunas, and with
# them the router offered a seven-hour Kaunas -> Šiauliai -> Vilnius trip as
# if it were a way between cities. Dropping them keeps every answer a city
# answer.
EXCLUDED_KINDS = {"intercitybus"}

SCHEMA = """
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;

CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE stop (
    id       INTEGER PRIMARY KEY,   -- dense 0..n-1, so RAPTOR can index arrays
    gtfs_id  TEXT NOT NULL UNIQUE,  -- '<city>:<stop_id>'; ids repeat across feeds
    name     TEXT NOT NULL,
    lat      REAL NOT NULL,
    lon      REAL NOT NULL,
    city     TEXT NOT NULL          -- the feed it came from, e.g. 'Klaipėda'
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
    gtfs_id    TEXT NOT NULL UNIQUE,  -- '<city>:<service_id>'
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
    gtfs_id    TEXT NOT NULL,       -- '<city>:<trip_id>'
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

-- The street a pattern's vehicles drive: the feed's shape most of its trips
-- use, as an encoded polyline (Google's algorithm, 1e-5 degrees). A pattern
-- whose trips name no shape has no row.
CREATE TABLE pattern_shape (
    pattern_id INTEGER PRIMARY KEY REFERENCES pattern(id),
    polyline   TEXT NOT NULL
);

-- Derived here: no feed ships a transfers.txt.
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

DAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

# A shape is thinned (Douglas-Peucker) to within this of the feed's own line.
SHAPE_TOLERANCE_M = 1.0


def encode_polyline(points: list[tuple[float, float]]) -> str:
    """Google's encoded polyline, 1e-5 degrees: about 1 m, 4-6 bytes a point."""
    out, last = [], (0, 0)
    for lat, lon in points:
        here = (round(lat * 1e5), round(lon * 1e5))
        for value in (here[0] - last[0], here[1] - last[1]):
            value = ~(value << 1) if value < 0 else value << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        last = here
    return "".join(out)


def thin(points: list[tuple[float, float]], tolerance_m: float = SHAPE_TOLERANCE_M) -> list[tuple[float, float]]:
    """Douglas-Peucker, iterative (a long shape would overflow recursion), in
    a flat local projection, which is exact enough across one city."""
    if len(points) < 3:
        return points
    lat0 = math.radians(points[0][0])
    xy = [(lon * 111_320 * math.cos(lat0), lat * 110_540) for lat, lon in points]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        length2 = dx * dx + dy * dy
        worst, worst_i = -1.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            if length2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                f = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
                d = math.hypot(px - (ax + f * dx), py - (ay + f * dy))
            if d > worst:
                worst, worst_i = d, i
        if worst > tolerance_m:
            keep[worst_i] = True
            stack.extend(((a, worst_i), (worst_i, b)))
    return [p for p, k in zip(points, keep) if k]


def parse_time(value: str) -> int:
    """`HH:MM:SS` -> seconds from the service day's midnight.

    Hours past 24 are legal and meaningful: `30:11:00` is 06:11 the following
    morning, still part of the previous service day. The feeds really do
    contain those, so this must not wrap.
    """
    hours, minutes, seconds = value.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + int(seconds)


def kind_of(route_id: str) -> str | None:
    """The kind token of `<city>_<kind>_<name>`, or None."""
    parts = route_id.split("_", 2)
    return parts[1] if len(parts) == 3 else None


def category_for(route_id: str) -> str:
    """`<city>_<kind>_<name>` -> category, for any city.

    Split from the left: names can contain underscores themselves
    (`klaipeda_bus_M6_TOKS`), so the kind is always the second token.
    """
    parts = route_id.split("_", 2)
    if len(parts) < 3:
        return "other"
    return CATEGORY_BY_KIND.get(parts[1], "other")


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres."""
    radius = 6_371_000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


class Feed:
    """Reads one city's GTFS CSVs out of a zip or a directory."""

    def __init__(self, slug: str, source: Path):
        if slug not in CITY_NAMES:
            raise SystemExit(f"unknown city {slug!r}; known: {', '.join(CITY_NAMES)}")
        self.slug = slug
        self.city = CITY_NAMES[slug]
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

    def sha256(self) -> str:
        """Full hex hash of the source: the zip's bytes, or its sorted .txt files."""
        if self.zip is not None:
            return hashlib.sha256(self.source.read_bytes()).hexdigest()
        h = hashlib.sha256()
        for name in sorted(p.name for p in self.source.glob("*.txt")):
            h.update((self.source / name).read_bytes())
        return h.hexdigest()


def combined_digest(feeds: list[Feed]) -> str:
    """One short hash over every feed, so the app can tell builds apart.

    Byte-for-byte what .github/workflows/gtfs.yml computes before building
    (`echo "<city> <sha256 of zip>"` per feed, in the same order, piped through
    sha256sum), so CI can skip a build when no feed changed.
    """
    lines = "".join(f"{feed.slug} {feed.sha256()}\n" for feed in feeds)
    return hashlib.sha256(lines.encode()).hexdigest()[:16]


class Builder:
    """Accumulates every feed into one set of rows with dense global ids."""

    def __init__(self):
        self.stop_rows: list[tuple] = []
        self.coords: list[tuple[float, float]] = []
        self.route_rows: list[tuple] = []
        self.service_rows: list[tuple] = []
        self.exceptions: dict[tuple[int, int], int] = {}
        self.pattern_rows: list[tuple] = []
        self.pattern_stop_rows: list[tuple] = []
        self.trip_rows: list[tuple] = []
        self.trip_time_rows: list[tuple] = []
        self.pattern_index: dict[tuple, int] = {}
        self.pattern_shape_rows: list[tuple[int, str]] = []
        self.cities: list[dict] = []

    def add(self, feed: Feed) -> None:
        ns = feed.slug + ":"
        before = (len(self.stop_rows), len(self.route_rows),
                  len(self.pattern_rows), len(self.trip_rows))

        # --- which lines stay ----------------------------------------------
        excluded_routes = {row["route_id"] for row in feed.rows("routes.txt")
                           if kind_of(row["route_id"]) in EXCLUDED_KINDS}
        trip_meta = {row["trip_id"]: row for row in feed.rows("trips.txt")
                     if row["route_id"] not in excluded_routes}

        sequences: dict[str, list[tuple[int, str, int, int]]] = defaultdict(list)
        served: set[str] = set()
        excluded_only: set[str] = set()
        for row in feed.rows("stop_times.txt"):
            if row["trip_id"] in trip_meta:
                served.add(row["stop_id"])
                sequences[row["trip_id"]].append((
                    int(row["stop_sequence"]),
                    row["stop_id"],
                    parse_time(row["arrival_time"]),
                    parse_time(row["departure_time"]),
                ))
            else:
                excluded_only.add(row["stop_id"])
        excluded_only -= served

        # --- stops ---------------------------------------------------------
        # Local GTFS ids -> global dense ids, scoped to this feed: stop 5118
        # in Kaunas is not stop 5118 in Vilnius. A stop served only by an
        # excluded line is left out; one served by nothing at all stays, as
        # before, since the feed lists it.
        stop_index: dict[str, int] = {}
        for row in feed.rows("stops.txt"):
            if row["stop_id"] in excluded_only:
                continue
            index = len(self.stop_rows)
            stop_index[row["stop_id"]] = index
            lat, lon = float(row["stop_lat"]), float(row["stop_lon"])
            self.stop_rows.append((index, ns + row["stop_id"], row["stop_name"].strip(),
                                   lat, lon, feed.city))
            self.coords.append((lat, lon))

        # --- routes --------------------------------------------------------
        route_index: dict[str, int] = {}
        for row in feed.rows("routes.txt"):
            if row["route_id"] in excluded_routes:
                continue
            index = len(self.route_rows)
            route_index[row["route_id"]] = index
            self.route_rows.append((
                index,
                row["route_id"],
                row["route_short_name"].strip(),
                (row.get("route_long_name") or "").strip() or None,
                category_for(row["route_id"]),
                int(row["route_type"]),
                (row.get("route_color") or "").strip().upper() or None,
                (row.get("route_text_color") or "").strip().upper() or None,
            ))

        # --- services ------------------------------------------------------
        service_index: dict[str, int] = {}
        for row in feed.rows("calendar.txt"):
            index = len(self.service_rows)
            service_index[row["service_id"]] = index
            mask = 0
            for bit, day in enumerate(DAYS):
                if row[day] == "1":
                    mask |= 1 << bit
            self.service_rows.append((index, ns + row["service_id"], mask,
                                      int(row["start_date"]), int(row["end_date"])))

        if feed.has("calendar_dates.txt"):
            for row in feed.rows("calendar_dates.txt"):
                sid = row["service_id"]
                if sid not in service_index:
                    # A service that appears only as an exception still needs a
                    # row, or its trips reference nothing.
                    index = len(self.service_rows)
                    service_index[sid] = index
                    self.service_rows.append((index, ns + sid, 0, 0, 99999999))
                # A repeated (service, date) keeps the last row, as the
                # single-feed build's INSERT OR REPLACE did.
                self.exceptions[(service_index[sid], int(row["date"]))] = (
                    1 if row["exception_type"] == "1" else 0)

        # --- trips and their stop sequences --------------------------------
        # (read above, excluded lines already filtered out)
        # Group trips into patterns by their ordered stop list.
        shapes_used: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        for trip_id in sorted(sequences):            # sorted for reproducible ids
            stops = sorted(sequences[trip_id])
            meta = trip_meta.get(trip_id)
            if meta is None or len(stops) < 2:
                continue

            route = route_index[meta["route_id"]]
            stop_ids = tuple(stop_index[s[1]] for s in stops)
            key = (route, stop_ids)
            if key not in self.pattern_index:
                pid = len(self.pattern_index)
                self.pattern_index[key] = pid
                self.pattern_rows.append((
                    pid,
                    route,
                    (meta.get("trip_headsign") or "").strip() or None,
                    int(meta["direction_id"]) if meta.get("direction_id") not in (None, "") else None,
                    len(stops),
                ))
                for seq, stop in enumerate(stop_ids):
                    self.pattern_stop_rows.append((pid, seq, stop))

            pid = self.pattern_index[key]
            if (meta.get("shape_id") or "").strip():
                shapes_used[pid][meta["shape_id"].strip()] += 1
            tid = len(self.trip_rows)
            self.trip_rows.append((tid, pid, service_index[meta["service_id"]],
                                   ns + trip_id, stops[0][3]))
            for seq, (_, _, arrival, departure) in enumerate(stops):
                self.trip_time_rows.append((tid, seq, arrival, departure))

        # --- the streets: each new pattern's most used shape -----------------
        shapes_written = 0
        if feed.has("shapes.txt") and shapes_used:
            wanted = {max(used.items(), key=lambda kv: (kv[1], kv[0]))[0] for used in shapes_used.values()}
            points: dict[str, list[tuple[int, float, float]]] = defaultdict(list)
            for row in feed.rows("shapes.txt"):
                if row["shape_id"] in wanted:
                    points[row["shape_id"]].append((int(row["shape_pt_sequence"]),
                                                    float(row["shape_pt_lat"]), float(row["shape_pt_lon"])))
            encoded: dict[str, str] = {}
            for shape_id, rows in points.items():
                line = [(lat, lon) for _, lat, lon in sorted(rows)]
                if len(line) >= 2:
                    encoded[shape_id] = encode_polyline(thin(line))
            for pid in sorted(shapes_used):
                if pid < before[2]:
                    continue                    # a pattern of an earlier feed
                shape_id = max(shapes_used[pid].items(), key=lambda kv: (kv[1], kv[0]))[0]
                if shape_id in encoded:
                    self.pattern_shape_rows.append((pid, encoded[shape_id]))
                    shapes_written += 1

        self.cities.append({
            "slug": feed.slug,
            "name": feed.city,
            "feed_digest": feed.sha256()[:16],
            "stops": len(self.stop_rows) - before[0],
            "routes": len(self.route_rows) - before[1],
            "patterns": len(self.pattern_rows) - before[2],
            "trips": len(self.trip_rows) - before[3],
            "shapes": shapes_written,
        })

    def transfers(self, max_transfer_m: int) -> list[tuple[int, int, int]]:
        """Walkable stop pairs, found geometrically over every city at once.

        No feed has transfers.txt or parent_station. A grid of cells at least
        max_transfer_m across keeps this linear instead of comparing every
        pair. The cities are tens of kilometres apart, so a pair only crosses
        feeds where two networks share a street, such as a Šiauliai intercity
        stop at Vilnius bus station.
        """
        if not self.coords:
            return []
        lat_cell = max_transfer_m / 111_320.0        # degrees latitude per cell
        # A degree of longitude shrinks with latitude (~62 km at 56°N). A cell
        # as many degrees wide as it is tall would be ~225 m across, and the
        # ±1-cell search below would miss pairs 225-400 m apart east-west.
        # Sized for the most northerly stop, it is wide enough everywhere.
        max_lat = max(abs(lat) for lat, _ in self.coords)
        lon_cell = lat_cell / math.cos(math.radians(max_lat))

        grid: dict[tuple[int, int], list[int]] = defaultdict(list)
        for index, (lat, lon) in enumerate(self.coords):
            grid[(math.floor(lat / lat_cell), math.floor(lon / lon_cell))].append(index)

        pairs = []
        for index, (lat, lon) in enumerate(self.coords):
            gy, gx = math.floor(lat / lat_cell), math.floor(lon / lon_cell)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    for other in grid.get((gy + dy, gx + dx), ()):
                        if other == index:
                            continue
                        lat2, lon2 = self.coords[other]
                        distance = haversine_m(lat, lon, lat2, lon2)
                        if distance <= max_transfer_m:
                            pairs.append((index, other, round(distance)))
        return pairs


def build(feeds: list[Feed], db: sqlite3.Connection, max_transfer_m: int) -> dict:
    db.executescript(SCHEMA)
    builder = Builder()
    for feed in feeds:
        builder.add(feed)

    db.executemany("INSERT INTO stop (id, gtfs_id, name, lat, lon, city) VALUES (?,?,?,?,?,?)",
                   builder.stop_rows)
    db.executemany("INSERT INTO route VALUES (?,?,?,?,?,?,?,?)", builder.route_rows)
    db.executemany("INSERT INTO service VALUES (?,?,?,?,?)", builder.service_rows)
    db.executemany("INSERT INTO service_exception VALUES (?,?,?)",
                   [(sid, date, added) for (sid, date), added in builder.exceptions.items()])
    db.executemany("INSERT INTO pattern VALUES (?,?,?,?,?)", builder.pattern_rows)
    db.executemany("INSERT INTO pattern_stop VALUES (?,?,?)", builder.pattern_stop_rows)
    db.executemany("INSERT INTO trip VALUES (?,?,?,?,?)", builder.trip_rows)
    db.executemany("INSERT INTO trip_time VALUES (?,?,?,?)", builder.trip_time_rows)
    db.executemany("INSERT INTO pattern_shape VALUES (?,?)", builder.pattern_shape_rows)

    transfers = builder.transfers(max_transfer_m)
    db.executemany("INSERT OR REPLACE INTO transfer VALUES (?,?,?)", transfers)

    city_of = [row[5] for row in builder.stop_rows]
    stats = {
        "stops": len(builder.stop_rows),
        "routes": len(builder.route_rows),
        "services": len(builder.service_rows),
        "service_exceptions": len(builder.exceptions),
        "patterns": len(builder.pattern_rows),
        "trips": len(builder.trip_rows),
        "stop_times": len(builder.trip_time_rows),
        "pattern_shapes": len(builder.pattern_shape_rows),
        "transfers": len(transfers),
        "cross_city_transfers": sum(1 for a, b, _ in transfers if city_of[a] != city_of[b]),
        "max_departure_s": max((t[3] for t in builder.trip_time_rows), default=0),
        "cities": builder.cities,
    }

    # --- metadata and indexes ---------------------------------------------
    # schema_version stays 1: stop.city and meta.cities are additions, and the
    # app refuses any other version outright (TimetableLoader.swift).
    db.executemany("INSERT INTO meta VALUES (?,?)", [
        ("schema_version", "1"),
        ("feed_digest", combined_digest(feeds)),
        ("max_transfer_m", str(max_transfer_m)),
        ("stops", str(stats["stops"])),
        ("patterns", str(stats["patterns"])),
        ("trips", str(stats["trips"])),
        ("cities", json.dumps(builder.cities, ensure_ascii=False)),
    ])
    db.executescript(INDEXES)
    db.commit()
    db.execute("VACUUM")
    db.commit()
    return stats


def parse_feed_arg(value: str) -> tuple[str, Path]:
    slug, sep, path = value.partition("=")
    if not sep or not slug.strip() or not path:
        raise argparse.ArgumentTypeError(f"expected city=path, got {value!r}")
    return slug.strip().lower(), Path(path)


def main() -> None:
    # City names need UTF-8; a Windows pipe would otherwise encode cp1252 and
    # crash on 'Klaipėda' (in --help, too).
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", type=Path, nargs="+",
                        help="<out.sqlite> with --feed; otherwise <gtfs.zip|dir> <out.sqlite> for Vilnius alone")
    parser.add_argument("--feed", action="append", type=parse_feed_arg, default=[],
                        metavar="CITY=PATH",
                        help=f"a feed to merge, repeatable, in id order; CITY is one of {', '.join(CITY_NAMES)}")
    parser.add_argument("--max-transfer-m", type=int, default=400,
                        help="furthest walkable stop-to-stop transfer, metres")
    args = parser.parse_args()

    if args.feed:
        if len(args.paths) != 1:
            parser.error("with --feed, give only the output path")
        sources, output = args.feed, args.paths[0]
    else:
        # The original single-feed form, kept so older commands still work.
        if len(args.paths) != 2:
            parser.error("give --feed city=path ... <out.sqlite>, or <gtfs.zip|dir> <out.sqlite>")
        sources, output = [("vilnius", args.paths[0])], args.paths[1]

    slugs = [slug for slug, _ in sources]
    if len(set(slugs)) != len(slugs):
        parser.error(f"a city was given twice: {slugs}")
    feeds = [Feed(slug, path) for slug, path in sources]

    if output.exists():
        output.unlink()
    output.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(output) as db:
        stats = build(feeds, db, args.max_transfer_m)

    size = output.stat().st_size
    print(f"wrote {output} ({size/1e6:.1f} MB)")
    for key in ("stops", "routes", "services", "service_exceptions", "patterns", "trips",
                "stop_times", "pattern_shapes", "transfers", "cross_city_transfers", "max_departure_s"):
        print(f"  {key:20} {stats[key]:>10,}")
    for city in stats["cities"]:
        print(f"  {city['name']:10} stops {city['stops']:>6,}  routes {city['routes']:>4}"
              f"  patterns {city['patterns']:>5,}  trips {city['trips']:>7,}")

    # A feed whose latest departure does not pass midnight means the times were
    # parsed wrong and the night network is gone.
    if stats["max_departure_s"] <= 86_400:
        print("\nWARNING: no departures past 24:00:00 - after-midnight service "
              "may have been parsed incorrectly", file=sys.stderr)


if __name__ == "__main__":
    main()
