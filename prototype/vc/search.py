"""Finding a place from what someone typed or said.

Two sources, merged:
- the timetable's own stop names, instantly and offline;
- Photon, a free OpenStreetMap geocoder, for addresses and places anywhere in
  Lithuania. No key needed. Biased to Vilnius but not limited to it.
"""

from __future__ import annotations

import json
import math
import re
import threading
import urllib.parse
import urllib.request

from .data import USER_AGENT, Timetable
from .speech_lt import fold

VILNIUS = (54.6872, 25.2797)
PHOTON = "https://photon.komoot.io/api/?"
# Lithuania, as min lon, min lat, max lon, max lat. Without it "Akropolis"
# returns Athens and Šiauliai before the mall on Ozo g.
LITHUANIA_BBOX = "20.9,53.89,26.84,56.45"

# What people travel to, versus what merely shares the name.
IMPORTANT = {
    "mall", "university", "college", "school", "kindergarten", "hospital", "clinic",
    "station", "stadium", "sports_centre", "cinema", "theatre", "marketplace",
    "museum", "attraction", "library", "townhall", "supermarket", "office",
    "arts_centre", "church", "cathedral", "park", "airport", "aerodrome",
}
INCIDENTAL = {
    "construction", "parking", "parking_space", "parcel_locker", "atm",
    "vending_machine", "bench", "waste_basket", "bicycle_parking", "isolated_dwelling",
    "post_box", "telephone", "charging_station", "toilets",
}
KINDS = {"mall": "Prekybos centras", "university": "Universitetas", "college": "Kolegija",
         "school": "Mokykla", "hospital": "Ligoninė", "station": "Stotis", "cinema": "Kinas",
         "stadium": "Stadionas", "museum": "Muziejus", "supermarket": "Parduotuvė"}


class StopIndex:
    """Stops grouped by name: "Žaliasis tiltas" is one place to a person, even
    though the timetable has a stop for each direction."""

    def __init__(self, t: Timetable):
        groups: dict[str, list[int]] = {}
        for stop, name in enumerate(t.stop_names):
            groups.setdefault(name, []).append(stop)
        self.entries = []
        for name, ids in groups.items():
            lat = sum(t.stop_lat[i] for i in ids) / len(ids)
            lon = sum(t.stop_lon[i] for i in ids) / len(ids)
            self.entries.append((fold(name), name, lat, lon))

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """Stops whose name matches, each tagged with how well."""
        q = fold(query).strip()
        if len(q) < 2:
            return []
        words = q.split()
        scored = []
        for folded, name, lat, lon in self.entries:
            if all(word in folded for word in words):
                if folded == q:
                    score = 0
                elif folded.startswith(q):
                    score = 1
                elif any(part.startswith(words[0]) for part in folded.split()):
                    score = 2
                else:
                    score = 3
                scored.append((score, len(folded), name, lat, lon))
        scored.sort()
        return [
            {"kind": "stop", "name": name, "subtitle": "Stotelė", "lat": lat, "lon": lon, "score": score}
            for score, _, name, lat, lon in scored[:limit]
        ]


_cache: dict[str, list[dict]] = {}
_lock = threading.Lock()


def places(query: str, limit: int = 7) -> list[dict]:
    key = fold(query).strip()
    if len(key) < 2:
        return []
    with _lock:
        if key in _cache:
            return _cache[key]

    url = PHOTON + urllib.parse.urlencode(
        {"q": query, "lat": VILNIUS[0], "lon": VILNIUS[1], "limit": 15, "bbox": LITHUANIA_BBOX}
    )
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=6) as response:
            data = json.loads(response.read())
    except Exception:  # noqa: BLE001 - offline or throttled: stops still work
        return []

    found, seen = [], set()
    for feature in data.get("features", []):
        p = feature.get("properties", {})
        if p.get("countrycode") not in (None, "LT"):
            continue
        lon, lat = feature["geometry"]["coordinates"]
        street = " ".join(x for x in (p.get("street"), p.get("housenumber")) if x)
        name = p.get("name") or street
        if not name:
            continue
        # PLC „Akropolis“ is called Akropolis by everyone who goes there.
        branded = re.match(r"^(?:PLC|PC|TC|PPC)\s+[„\"](.+?)[“\"]$", name)
        if branded:
            name = branded.group(1)
        kind = p.get("osm_value", "")
        where = p.get("city") or p.get("county") or p.get("state") or ""
        label = KINDS.get(kind, "")
        subtitle = ", ".join(x for x in (label, street if street != name else "", where) if x)
        identity = (fold(name), round(lat, 3), round(lon, 3))
        if identity in seen:
            continue
        seen.add(identity)

        score = 0.0
        if fold(where) == "vilnius":
            score -= 2
        if kind in IMPORTANT:
            score -= 2
        if kind in INCIDENTAL:
            score += 3
        if fold(name) == key:
            score -= 1
        score += distance_km(lat, lon) / 50
        found.append({"kind": "place", "name": name, "subtitle": subtitle, "lat": lat, "lon": lon, "score": score})

    found.sort(key=lambda item: item["score"])   # stable: Photon's order breaks ties
    found = found[:limit]

    with _lock:
        _cache[key] = found
    return found


def distance_km(lat: float, lon: float) -> float:
    dlat = (lat - VILNIUS[0]) * 111.2
    dlon = (lon - VILNIUS[1]) * 111.2 * math.cos(math.radians(VILNIUS[0]))
    return math.hypot(dlat, dlon)


def search(index: StopIndex, query: str) -> list[dict]:
    stops = index.search(query)
    found = places(query)
    # A stop that matches from the start of a word is probably what was
    # meant; one that only contains the letters ("ism" in "Vismaliukai") is not.
    strong = [s for s in stops if s["score"] <= 2]
    weak = [s for s in stops if s["score"] > 2]
    looks_like_address = any(ch.isdigit() for ch in query)
    merged = found + strong + weak if looks_like_address else strong[:3] + found + strong[3:] + weak
    seen, out = set(), []
    for item in merged:
        identity = (fold(item["name"]), round(item["lat"], 3), round(item["lon"], 3))
        if identity not in seen:
            seen.add(identity)
            out.append(item)
    return out[:10]
