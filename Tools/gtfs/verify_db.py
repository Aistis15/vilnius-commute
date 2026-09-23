#!/usr/bin/env python3
"""Assert that a built database is fit to ship.

This runs in CI between building the database and publishing it. A daily job
that silently publishes a broken database is worse than one that fails: the
app would download it and route people wrongly.

The checks are deliberately about *meaning*, not just structure. The one that
matters most is `night_service`: if after-midnight times were parsed as a wall
clock they would wrap to early morning, the database would still look
perfectly well-formed, and the entire night network would be gone.

Usage: verify_db.py <db.sqlite>
Exits non-zero, listing every failure, if anything is wrong.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

KNOWN_CATEGORIES = {"bus", "expressBus", "nightBus", "trolleybus", "ferry", "other"}

# Floors, not exact counts: the feed changes daily and the point is to catch a
# collapse (a parse that dropped most rows), not to pin today's numbers.
MINIMUMS = {
    "stop": 1_000,
    "route": 80,
    "pattern": 400,
    "trip": 15_000,
    "trip_time": 300_000,
    "service": 50,
    "transfer": 1_000,
}


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

    # --- the night network --------------------------------------------------
    # GTFS expresses after-midnight service as hours >= 24. The feed reaches
    # 30:11:00. If the maximum sits at or below 86400 the times were wrapped
    # and every night trip now claims to run in the early morning of the wrong
    # service day.
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

    # --- referential integrity ---------------------------------------------
    orphans = [
        ("pattern.route_id", "SELECT count(*) FROM pattern p LEFT JOIN route r ON r.id=p.route_id WHERE r.id IS NULL"),
        ("pattern_stop.pattern_id", "SELECT count(*) FROM pattern_stop ps LEFT JOIN pattern p ON p.id=ps.pattern_id WHERE p.id IS NULL"),
        ("pattern_stop.stop_id", "SELECT count(*) FROM pattern_stop ps LEFT JOIN stop s ON s.id=ps.stop_id WHERE s.id IS NULL"),
        ("trip.pattern_id", "SELECT count(*) FROM trip t LEFT JOIN pattern p ON p.id=t.pattern_id WHERE p.id IS NULL"),
        ("trip.service_id", "SELECT count(*) FROM trip t LEFT JOIN service s ON s.id=t.service_id WHERE s.id IS NULL"),
        ("trip_time.trip_id", "SELECT count(*) FROM trip_time tt LEFT JOIN trip t ON t.id=tt.trip_id WHERE t.id IS NULL"),
        ("transfer.from_stop", "SELECT count(*) FROM transfer x LEFT JOIN stop s ON s.id=x.from_stop WHERE s.id IS NULL"),
    ]
    for label, sql in orphans:
        count = one(sql)
        if count:
            problems.append(f"{count} orphan rows in {label}")

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

    return problems


def main() -> None:
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

    stops, routes, patterns, trips, max_departure = summary
    print(f"{path.name}: {stops:,} stops, {routes} routes, {patterns} patterns, "
          f"{trips:,} trips, latest departure "
          f"{max_departure // 3600:02d}:{(max_departure % 3600) // 60:02d}")

    if problems:
        print(f"\nFAILED — {len(problems)} problem(s):", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        raise SystemExit(1)

    print("all checks passed")


if __name__ == "__main__":
    main()
