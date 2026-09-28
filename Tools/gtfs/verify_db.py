#!/usr/bin/env python3
"""Assert that a built database is fit to ship.

This runs in CI between building the database and publishing it. A daily job
that silently publishes a broken database is worse than one that fails: the
app would download it and route people wrongly.

The checks are deliberately about *meaning*, not just structure. The one that
matters most is `night_service`: if after-midnight times were parsed as a wall
clock they would wrap to early morning, the database would still look
perfectly well-formed, and the entire night network would be gone. The second
is that every city is present and self-contained: a merge that shifted one
feed's ids by a single row would also look well-formed, and would route Kaunas
buses through Vilnius stops.

Usage: verify_db.py <db.sqlite>
Exits non-zero, listing every failure, if anything is wrong.
"""

from __future__ import annotations

import json
import math
import sqlite3
import sys
from pathlib import Path

KNOWN_CATEGORIES = {"bus", "expressBus", "nightBus", "trolleybus", "ferry", "other"}

# Floors, not exact counts: the feeds change daily and the point is to catch a
# collapse (a parse that dropped most rows), not to pin today's numbers. These
# are for all five cities together, roughly 60% of the 2026-09-26 build.
MINIMUMS = {
    "stop": 2_500,
    "route": 190,
    "pattern": 850,
    "trip": 25_000,
    "trip_time": 550_000,
    "service": 150,
    "transfer": 5_000,
}

# route_id / gtfs_id prefix -> (stop.city, min stops, min routes, min trips).
# Same ~60% rule per city, so one feed collapsing cannot hide behind the others.
# Measured 2026-09-26: Vilnius 1 548/115/20 846, Kaunas 966/69/7 191,
# Klaipėda 928/69/7 049. (Šiauliai and Panevėžys left the product on
# 2026-09-27: the three cities with live vehicle data remain.)
CITIES = {
    "vilnius": ("Vilnius", 1_000, 80, 15_000),
    "kaunas": ("Kaunas", 600, 40, 4_300),
    "klaipeda": ("Klaipėda", 550, 40, 4_200),
}

# Every feed ships shapes.txt (1 184 of 1 184 patterns had a street on
# 2026-09-28). Fewer than this share means the shapes were lost, and the app
# would draw rides through buildings again.
MIN_SHAPED = 0.9
# A pattern's first and last stops lie on its street. A shape given to the
# wrong pattern would be far from them. (A short working may use its line's
# full street, which begins further back: that is fine, the stops are still
# on it.)
SHAPE_REACH_M = 300


def decode(polyline: str) -> list[tuple[float, float]]:
    """A Google encoded polyline's points."""
    values, index = [], 0
    while index < len(polyline):
        shift = result = 0
        while True:
            byte = ord(polyline[index]) - 63
            index += 1
            result |= (byte & 0x1F) << shift
            shift += 5
            if byte < 0x20:
                break
        values.append(~(result >> 1) if result & 1 else result >> 1)
    points, lat, lon = [], 0, 0
    for dlat, dlon in zip(values[0::2], values[1::2]):
        lat, lon = lat + dlat, lon + dlon
        points.append((lat / 1e5, lon / 1e5))
    return points


def nearest_m(points: list[tuple[float, float]], lat: float, lon: float) -> float:
    k = math.cos(math.radians(lat))
    return min(math.hypot((a - lat) * 110_540, (b - lon) * 111_320 * k) for a, b in points)


# The city a route belongs to, from its id: `kaunas_bus_3` -> `kaunas`.
ROUTE_CITY = "substr(r.gtfs_id, 1, instr(r.gtfs_id, '_') - 1)"


def check(db: sqlite3.Connection) -> list[str]:
    problems: list[str] = []
    q = lambda sql, *a: db.execute(sql, a).fetchall()
    one = lambda sql, *a: db.execute(sql, a).fetchone()[0]

    # --- structural ---------------------------------------------------------
    tables = {r[0] for r in q("SELECT name FROM sqlite_master WHERE type='table'")}
    for name in set(MINIMUMS) | {"meta", "pattern_stop", "service_exception"}:
        if name not in tables:
            problems.append(f"missing table: {name}")
    if problems:
        return problems                      # nothing else will make sense

    for table, floor in MINIMUMS.items():
        count = one(f"SELECT count(*) FROM {table}")
        if count < floor:
            problems.append(f"{table}: only {count:,} rows, expected at least {floor:,}")

    if one("SELECT count(*) FROM meta WHERE key='schema_version'") != 1:
        problems.append("meta.schema_version is missing")

    # --- the streets --------------------------------------------------------
    if "pattern_shape" not in tables:
        problems.append("missing table: pattern_shape")
    else:
        patterns = one("SELECT count(*) FROM pattern")
        rows = q("SELECT ps.polyline, a.lat, a.lon, b.lat, b.lon FROM pattern_shape ps"
                 " JOIN pattern p ON p.id = ps.pattern_id"
                 " JOIN pattern_stop sa ON sa.pattern_id = p.id AND sa.seq = 0"
                 " JOIN pattern_stop sb ON sb.pattern_id = p.id AND sb.seq = p.num_stops - 1"
                 " JOIN stop a ON a.id = sa.stop_id JOIN stop b ON b.id = sb.stop_id")
        if len(rows) < MIN_SHAPED * patterns:
            problems.append(f"pattern_shape: only {len(rows):,} of {patterns:,} patterns have a street")
        astray = 0
        for polyline, alat, alon, blat, blon in rows:
            points = decode(polyline)
            astray += max(nearest_m(points, alat, alon), nearest_m(points, blat, blon)) > SHAPE_REACH_M
        if rows and astray > 0.02 * len(rows):
            problems.append(f"pattern_shape: {astray} of {len(rows)} streets pass over {SHAPE_REACH_M} m"
                            " from their pattern's first or last stop")

    # --- the night network --------------------------------------------------
    # GTFS expresses after-midnight service as hours >= 24. The Vilnius feed
    # reaches 30:11:00. If the maximum sits at or below 86400 the times were
    # wrapped and every night trip now claims to run in the early morning of
    # the wrong service day.
    max_departure = one("SELECT max(departure) FROM trip_time")
    if max_departure <= 86_400:
        problems.append(
            f"max departure is {max_departure}s (<= 24:00:00): after-midnight "
            "times look wrapped, so the night network is wrong"
        )

    night_routes = one("SELECT count(*) FROM route WHERE category='nightBus'")
    if night_routes == 0:
        problems.append("no nightBus routes at all")

    # Night routes must actually have trips that run past midnight.
    late_night = one("""
        SELECT count(DISTINCT r.id) FROM route r
        JOIN pattern p ON p.route_id = r.id
        JOIN trip t ON t.pattern_id = p.id
        JOIN trip_time tt ON tt.trip_id = t.id
        WHERE r.category = 'nightBus' AND tt.departure > 86400
    """)
    if night_routes and late_night == 0:
        problems.append("nightBus routes exist but none run past 24:00:00")

    # --- categories and colours --------------------------------------------
    for (category,) in q("SELECT DISTINCT category FROM route"):
        if category not in KNOWN_CATEGORIES:
            problems.append(f"unknown category in route table: {category!r}")

    bad_colour = one("""
        SELECT count(*) FROM route
        WHERE color IS NOT NULL
          AND (length(color) != 6 OR upper(color) != color
               OR color GLOB '*[^0-9A-F]*')
    """)
    if bad_colour:
        problems.append(f"{bad_colour} routes have a malformed colour")

    uncoloured = one("SELECT count(*) FROM route WHERE color IS NULL OR color = ''")
    if uncoloured:
        problems.append(f"{uncoloured} routes have no colour at all")

    # --- cities ---------------------------------------------------------------
    problems += check_cities(db)

    # --- referential integrity ---------------------------------------------
    orphans = [
        ("pattern.route_id", "SELECT count(*) FROM pattern p LEFT JOIN route r ON r.id=p.route_id WHERE r.id IS NULL"),
        ("pattern_stop.pattern_id", "SELECT count(*) FROM pattern_stop ps LEFT JOIN pattern p ON p.id=ps.pattern_id WHERE p.id IS NULL"),
        ("pattern_stop.stop_id", "SELECT count(*) FROM pattern_stop ps LEFT JOIN stop s ON s.id=ps.stop_id WHERE s.id IS NULL"),
        ("trip.pattern_id", "SELECT count(*) FROM trip t LEFT JOIN pattern p ON p.id=t.pattern_id WHERE p.id IS NULL"),
        ("trip.service_id", "SELECT count(*) FROM trip t LEFT JOIN service s ON s.id=t.service_id WHERE s.id IS NULL"),
        ("trip_time.trip_id", "SELECT count(*) FROM trip_time tt LEFT JOIN trip t ON t.id=tt.trip_id WHERE t.id IS NULL"),
        ("transfer.from_stop", "SELECT count(*) FROM transfer x LEFT JOIN stop s ON s.id=x.from_stop WHERE s.id IS NULL"),
        ("transfer.to_stop", "SELECT count(*) FROM transfer x LEFT JOIN stop s ON s.id=x.to_stop WHERE s.id IS NULL"),
    ]
    for label, sql in orphans:
        count = one(sql)
        if count:
            problems.append(f"{count} orphan rows in {label}")

    # The app indexes arrays by these ids (TimetableLoader.swift), so a gap
    # would shift every row after it.
    for table in ("stop", "service"):
        count, low, high = db.execute(f"SELECT count(*), min(id), max(id) FROM {table}").fetchone()
        if count and (low != 0 or high != count - 1):
            problems.append(f"{table} ids are not dense 0..{count - 1} (min {low}, max {high})")

    # --- routing invariants -------------------------------------------------
    short_patterns = one("SELECT count(*) FROM pattern WHERE num_stops < 2")
    if short_patterns:
        problems.append(f"{short_patterns} patterns have fewer than 2 stops")

    mismatched = one("""
        SELECT count(*) FROM (
          SELECT t.id FROM trip t
          JOIN pattern p ON p.id = t.pattern_id
          JOIN trip_time tt ON tt.trip_id = t.id
          GROUP BY t.id, p.num_stops
          HAVING count(tt.seq) != p.num_stops
        )
    """)
    if mismatched:
        problems.append(f"{mismatched} trips have a different number of stop times than their pattern")

    backwards = one("SELECT count(*) FROM trip_time WHERE departure < arrival")
    if backwards:
        problems.append(f"{backwards} stop times depart before they arrive")

    non_monotonic = one("""
        SELECT count(*) FROM (
          SELECT tt.trip_id FROM trip_time tt
          JOIN trip_time nxt ON nxt.trip_id = tt.trip_id AND nxt.seq = tt.seq + 1
          WHERE nxt.arrival < tt.departure
          GROUP BY tt.trip_id
        )
    """)
    if non_monotonic:
        problems.append(f"{non_monotonic} trips go backwards in time between stops")

    # Transfers must be usable in both directions or RAPTOR's walk step is
    # asymmetric for no reason.
    asymmetric = one("""
        SELECT count(*) FROM transfer a WHERE NOT EXISTS (
          SELECT 1 FROM transfer b WHERE b.from_stop = a.to_stop AND b.to_stop = a.from_stop)
    """)
    if asymmetric:
        problems.append(f"{asymmetric} transfers are not symmetric")

    self_transfer = one("SELECT count(*) FROM transfer WHERE from_stop = to_stop")
    if self_transfer:
        problems.append(f"{self_transfer} transfers go from a stop to itself")

    # A walk longer than the build's own limit means the grid or the distance
    # maths broke, and could join stops in different cities.
    limit = db.execute("SELECT value FROM meta WHERE key='max_transfer_m'").fetchone()
    if limit:
        too_far = one("SELECT count(*) FROM transfer WHERE meters > ?", int(limit[0]))
        if too_far:
            problems.append(f"{too_far} transfers are longer than max_transfer_m ({limit[0]} m)")

    return problems


def check_cities(db: sqlite3.Connection) -> list[str]:
    """Every city present, big enough, labelled, and not tangled with another."""
    problems: list[str] = []
    one = lambda sql, *a: db.execute(sql, a).fetchone()[0]

    columns = {row[1] for row in db.execute("PRAGMA table_info(stop)")}
    if "city" not in columns:
        return ["stop.city column is missing: built by a pre-merge build_db.py?"]

    unlabelled = one("SELECT count(*) FROM stop WHERE city IS NULL OR trim(city) = ''")
    if unlabelled:
        problems.append(f"{unlabelled} stops have no city")

    names = {name for name, *_ in CITIES.values()}
    for (city, count) in db.execute("SELECT city, count(*) FROM stop GROUP BY city"):
        if city and city not in names:
            problems.append(f"{count} stops belong to an unknown city {city!r}")

    stops = dict(db.execute("SELECT city, count(*) FROM stop GROUP BY city").fetchall())
    routes = dict(db.execute(f"SELECT {ROUTE_CITY}, count(*) FROM route r GROUP BY 1").fetchall())
    trips = dict(db.execute(f"""
        SELECT {ROUTE_CITY}, count(*) FROM trip t
        JOIN pattern p ON p.id = t.pattern_id
        JOIN route r ON r.id = p.route_id
        GROUP BY 1
    """).fetchall())
    for slug, (name, min_stops, min_routes, min_trips) in CITIES.items():
        for label, have, floor in (("stops", stops.get(name, 0), min_stops),
                                   ("routes", routes.get(slug, 0), min_routes),
                                   ("trips", trips.get(slug, 0), min_trips)):
            if have < floor:
                problems.append(f"{name}: only {have:,} {label}, expected at least {floor:,}")

    unknown_routes = set(routes) - set(CITIES)
    if unknown_routes:
        problems.append(f"routes from unknown cities: {sorted(unknown_routes)}")

    # A pattern must stay inside its own feed. If one feed's stop ids were
    # offset during the merge, its buses would visit another city's stops.
    case = " ".join(f"WHEN '{slug}' THEN '{name}'" for slug, (name, *_) in CITIES.items())
    tangled = one(f"""
        SELECT count(DISTINCT p.id) FROM pattern p
        JOIN route r ON r.id = p.route_id
        JOIN pattern_stop ps ON ps.pattern_id = p.id
        JOIN stop s ON s.id = ps.stop_id
        WHERE s.city != CASE {ROUTE_CITY} {case} END
    """)
    if tangled:
        problems.append(f"{tangled} patterns visit stops of a different city than their route")

    # Stop ids are namespaced by feed; the namespace must agree with the label.
    slug_case = " ".join(f"WHEN '{name}' THEN '{slug}:'" for slug, (name, *_) in CITIES.items())
    mislabelled = one(f"""
        SELECT count(*) FROM stop
        WHERE substr(gtfs_id, 1, length(CASE city {slug_case} END)) != CASE city {slug_case} END
    """)
    if mislabelled:
        problems.append(f"{mislabelled} stops have a gtfs_id namespace that disagrees with their city")

    # meta.cities is what the manifest and the app read; it must match the rows.
    raw = db.execute("SELECT value FROM meta WHERE key='cities'").fetchone()
    if raw is None:
        problems.append("meta.cities is missing")
    else:
        try:
            listed = {c["name"]: c for c in json.loads(raw[0])}
        except (ValueError, TypeError, KeyError) as error:
            problems.append(f"meta.cities is not a list of cities: {error}")
        else:
            if set(listed) != set(stops):
                problems.append(f"meta.cities lists {sorted(listed)}, stops have {sorted(stops)}")
            for name, entry in listed.items():
                if entry.get("stops") != stops.get(name):
                    problems.append(f"meta.cities says {name} has {entry.get('stops')} stops, "
                                    f"the stop table has {stops.get(name)}")
    return problems


def main() -> None:
    # City names need UTF-8; a Windows pipe would otherwise encode cp1252 and
    # crash on 'Klaipėda'.
    for stream in (sys.stdout, sys.stderr):
        stream.reconfigure(encoding="utf-8")

    if len(sys.argv) != 2:
        raise SystemExit("usage: verify_db.py <db.sqlite>")

    path = Path(sys.argv[1])
    if not path.exists():
        raise SystemExit(f"no such database: {path}")

    with sqlite3.connect(path) as db:
        problems = check(db)
        summary = db.execute(
            "SELECT (SELECT count(*) FROM stop), (SELECT count(*) FROM route),"
            " (SELECT count(*) FROM pattern), (SELECT count(*) FROM trip),"
            " (SELECT max(departure) FROM trip_time)"
        ).fetchone()
        has_city = any(row[1] == "city" for row in db.execute("PRAGMA table_info(stop)"))
        per_city = db.execute(
            "SELECT city, count(*) FROM stop GROUP BY city ORDER BY min(id)"
        ).fetchall() if has_city else []

    stops, routes, patterns, trips, max_departure = summary
    print(f"{path.name}: {stops:,} stops, {routes} routes, {patterns} patterns, "
          f"{trips:,} trips, latest departure "
          f"{max_departure // 3600:02d}:{(max_departure % 3600) // 60:02d}")
    if per_city:
        print("stops by city: " + ", ".join(f"{city} {count:,}" for city, count in per_city))

    if problems:
        print(f"\nFAILED — {len(problems)} problem(s):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        raise SystemExit(1)

    print("all checks passed")


if __name__ == "__main__":
    main()
