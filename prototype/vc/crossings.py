"""Pedestrian crossings, for walking directions that say "Pereik gatvę per
perėją" exactly where the path crosses a street.

The data is every highway=crossing node of OpenStreetMap inside the three
cities, with its kind and the street it crosses: built weekly in CI from
Geofabrik's Lithuania extract (Tools/osm/crossings.py) and published as
crossings.json.gz next to the timetables. The walking router works on the
same OpenStreetMap data and names the nodes a path goes through, so a
crossing on the path is a match by id. Data © OpenStreetMap contributors,
ODbL.
"""

from __future__ import annotations

import gzip
import json
import time

from . import data

URL = data.RELEASE + "crossings.json.gz"
PATH = data.DATA_DIR / "crossings.json"
MAX_AGE_S = 7 * 86_400

# Two nodes of one crossing (the halves either side of a traffic island)
# are one instruction.
SAME_CROSSING_M = 14


def load(log=print) -> dict[int, tuple[float, float, str, str]]:
    """{osm node id: (lat, lon, kind, street)}, downloaded when missing or a
    week old. Empty without a copy and without the internet: directions
    then simply do not mention crossings."""
    data.DATA_DIR.mkdir(exist_ok=True)
    fresh = PATH.exists() and time.time() - PATH.stat().st_mtime < MAX_AGE_S
    if not fresh:
        try:
            PATH.write_bytes(gzip.decompress(data._fetch(URL)))
        except Exception as error:  # noqa: BLE001 - crossings are a help, not a need
            log(f"Could not fetch crossings ({error}).")
    if not PATH.exists():
        return {}
    rows = json.loads(PATH.read_text("utf-8")).get("crossings", [])
    return {int(r[0]): (r[1], r[2], r[3], r[4]) for r in rows}


def on_route(route: dict, nodes: list[int], index: dict) -> list[dict]:
    """The crossings a walking path goes through, in order along it:
    [{"at": metres from the start, "kind": "marked" | "unmarked", "road": name}]."""
    found = []
    for i, node in enumerate(nodes[: len(route["along"])]):
        crossing = index.get(node)
        if crossing is None:
            continue
        at = route["along"][i]
        if found and at - found[-1]["at"] < SAME_CROSSING_M:
            if not found[-1]["road"]:
                found[-1]["road"] = crossing[3]
            continue
        found.append({"at": round(at, 1), "kind": crossing[2], "road": crossing[3]})
    return found
