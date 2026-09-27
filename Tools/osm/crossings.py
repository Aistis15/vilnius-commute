#!/usr/bin/env python3
"""Pedestrian crossings of the three cities, from OpenStreetMap, for walking
directions that say "Pereik gatvę per perėją" where the path crosses one.

Runs in CI (.github/workflows/osm.yml) over Geofabrik's Lithuania extract:

    python Tools/osm/crossings.py lithuania-latest.osm.pbf crossings.json

Every node tagged highway=crossing inside the cities' boxes, with what kind
of crossing it is and the name of the street it crosses (the named road way
the node belongs to). The walking router (OSRM on OpenStreetMap data) returns
the node ids a path goes through, so a crossing on the path is an exact
match by id. Data © OpenStreetMap contributors, ODbL.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

import osmium

# south, west, north, east: each city with the suburbs its buses reach.
CITIES = {
    "Vilnius": (54.55, 25.00, 54.86, 25.52),
    "Kaunas": (54.80, 23.70, 55.00, 24.12),
    "Klaipėda": (55.55, 21.05, 55.80, 21.32),
}
# Ways a crossing does not cross: the path itself.
NOT_ROADS = {"footway", "path", "steps", "pedestrian", "cycleway", "corridor", "platform",
             "bridleway", "elevator", "crossing", "sidewalk"}


def kind(tags) -> str | None:
    """"marked" (a perėja: zebra or lights), "unmarked", or None when
    crossing there is not allowed."""
    crossing = tags.get("crossing", "")
    if crossing == "no":
        return None
    markings = tags.get("crossing:markings", "")
    if crossing == "unmarked" or markings == "no":
        return "unmarked"
    return "marked"


def inside(lat: float, lon: float) -> bool:
    return any(s <= lat <= n and w <= lon <= e for s, w, n, e in CITIES.values())


class Crossings(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.found: dict[int, list] = {}

    def node(self, n) -> None:
        if n.tags.get("highway") != "crossing" or not n.location.valid():
            return
        lat, lon = n.location.lat, n.location.lon
        what = kind(n.tags)
        if what and inside(lat, lon):
            self.found[n.id] = [n.id, round(lat, 6), round(lon, 6), what, ""]

    def way(self, w) -> None:
        road = w.tags.get("highway")
        name = w.tags.get("name")
        if not road or road in NOT_ROADS or not name:
            return
        for ref in w.nodes:
            crossing = self.found.get(ref.ref)
            if crossing is not None and not crossing[4]:
                crossing[4] = name


def main(source: str, target: str) -> None:
    handler = Crossings()
    handler.apply_file(source)
    rows = sorted(handler.found.values())
    out = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": "OpenStreetMap contributors, ODbL (Geofabrik Lithuania extract)",
        "fields": ["osm_id", "lat", "lon", "kind", "road"],
        "crossings": rows,
    }
    with open(target, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    named = sum(1 for r in rows if r[4])
    print(f"{len(rows)} crossings ({named} with the street they cross) -> {target}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
