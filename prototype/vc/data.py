"""Schedule data: fetch, verify, load.

The same SQLite database the iPhone app uses, built daily by
Tools/gtfs/build_db.py and published on the `data-latest` release. Loading it
here, rather than inventing a second format, means the prototype and the app
route over identical data.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import sqlite3
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

RELEASE = "https://github.com/Aistis15/vilnius-commute/releases/download/data-latest/"
DATA_DIR = Path(__file__).resolve().parent.parent / ".data"
DB_PATH = DATA_DIR / "vilnius.sqlite"
MANIFEST_PATH = DATA_DIR / "manifest.json"
USER_AGENT = "vilnius-commute-prototype/0.1 (personal, non-commercial)"

# Fallback colours per category, used only when the feed gives none. The same
# values as TransitPalette.swift, which were checked against the live feed.
CATEGORY_COLOURS = {
    "bus": "0073AC",
    "expressBus": "008000",
    "nightBus": "000000",
    "trolleybus": "DC3131",
    "ferry": "00A59B",
}


def _fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def ensure_database(log=print) -> dict:
    """Download the database if missing or out of date. Returns the manifest.

    Works offline once a copy exists: a failed update keeps the old file.
    """
    DATA_DIR.mkdir(exist_ok=True)
    local = json.loads(MANIFEST_PATH.read_text("utf-8")) if MANIFEST_PATH.exists() else None

    try:
        remote = json.loads(_fetch(RELEASE + "manifest.json"))
    except Exception as error:  # noqa: BLE001 - any network failure means "stay offline"
        if local and DB_PATH.exists():
            log(f"Could not check for new timetables ({error}); using the copy from {local.get('built_at')}.")
            return local
        raise RuntimeError(f"No timetable yet and the download failed: {error}") from error

    if local and DB_PATH.exists() and local.get("sha256") == remote.get("sha256"):
        return local

    log("Downloading timetables…")
    blob = _fetch(RELEASE + "vilnius.sqlite.gz")
    # The manifest hashes the compressed file (see .github/workflows/gtfs.yml).
    digest = hashlib.sha256(blob).hexdigest()
    if digest != remote.get("sha256"):
        raise RuntimeError(f"Timetable download is corrupt: sha256 {digest} != {remote.get('sha256')}")
    raw = gzip.decompress(blob)

    temporary = DB_PATH.with_suffix(".tmp")
    temporary.write_bytes(raw)
    temporary.replace(DB_PATH)
    MANIFEST_PATH.write_text(json.dumps(remote, indent=2), "utf-8")
    log(f"Timetables ready: {remote.get('stops')} stops, built {remote.get('built_at')}.")
    return remote


@dataclass
class Route:
    id: int
    short_name: str
    category: str
    color: str
    text_color: str


@dataclass
class Timetable:
    """Flat arrays, laid out like the Swift `Timetable` so the two routers
    stay comparable line by line."""

    stop_names: list[str] = field(default_factory=list)
    stop_lat: list[float] = field(default_factory=list)
    stop_lon: list[float] = field(default_factory=list)
    routes: list[Route] = field(default_factory=list)
    pattern_route: list[int] = field(default_factory=list)
    pattern_headsign: list[str | None] = field(default_factory=list)
    pattern_stops: list[list[int]] = field(default_factory=list)
    # Per pattern: trips sorted by departure; each trip is (service_id, [arrivals], [departures]).
    pattern_trips: list[list[tuple[int, list[int], list[int]]]] = field(default_factory=list)
    patterns_at_stop: list[list[tuple[int, int]]] = field(default_factory=list)
    transfers: list[list[tuple[int, int]]] = field(default_factory=list)
    services: list[tuple[int, int, int]] = field(default_factory=list)  # weekdays, start, end
    exceptions: dict[int, dict[int, bool]] = field(default_factory=dict)

    def runs(self, service_id: int, date: int, weekday: int) -> bool:
        """Identical rules to ServiceCalendar.runs in Swift."""
        override = self.exceptions.get(service_id, {}).get(date)
        if override is not None:
            return override
        if not 0 <= service_id < len(self.services):
            return False
        weekdays, start, end = self.services[service_id]
        if not start <= date <= end:
            return False
        return bool(weekdays & (1 << weekday))


def load_timetable(path: Path = DB_PATH) -> Timetable:
    db = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    t = Timetable()
    try:
        for _id, name, lat, lon in db.execute("SELECT id, name, lat, lon FROM stop ORDER BY id"):
            t.stop_names.append(name)
            t.stop_lat.append(lat)
            t.stop_lon.append(lon)
        stop_count = len(t.stop_names)

        for rid, short, category, color, text_color in db.execute(
            "SELECT id, short_name, category, color, text_color FROM route ORDER BY id"
        ):
            t.routes.append(Route(
                id=rid,
                short_name=short or "",
                category=category or "other",
                color=(color or CATEGORY_COLOURS.get(category, "0073AC")).upper(),
                text_color=(text_color or "FFFFFF").upper(),
            ))

        for _pid, route_id, headsign in db.execute("SELECT id, route_id, headsign FROM pattern ORDER BY id"):
            t.pattern_route.append(route_id)
            t.pattern_headsign.append(headsign)
        pattern_count = len(t.pattern_route)

        t.pattern_stops = [[] for _ in range(pattern_count)]
        for pid, sid in db.execute("SELECT pattern_id, stop_id FROM pattern_stop ORDER BY pattern_id, seq"):
            t.pattern_stops[pid].append(sid)

        times: dict[int, tuple[list[int], list[int]]] = {}
        for trip_id, arrival, departure in db.execute(
            "SELECT trip_id, arrival, departure FROM trip_time ORDER BY trip_id, seq"
        ):
            arrivals, departures = times.setdefault(trip_id, ([], []))
            arrivals.append(arrival)
            departures.append(departure)

        t.pattern_trips = [[] for _ in range(pattern_count)]
        for trip_id, pid, service_id in db.execute(
            "SELECT id, pattern_id, service_id FROM trip ORDER BY pattern_id, departure"
        ):
            arrivals, departures = times.get(trip_id, ([], []))
            if len(arrivals) == len(t.pattern_stops[pid]):
                t.pattern_trips[pid].append((service_id, arrivals, departures))

        t.patterns_at_stop = [[] for _ in range(stop_count)]
        for pid, stops in enumerate(t.pattern_stops):
            for index, sid in enumerate(stops):
                t.patterns_at_stop[sid].append((pid, index))

        t.transfers = [[] for _ in range(stop_count)]
        for a, b, metres in db.execute("SELECT from_stop, to_stop, meters FROM transfer ORDER BY from_stop, meters"):
            t.transfers[a].append((b, metres))

        for _sid, weekdays, start, end in db.execute(
            "SELECT id, weekdays, start_date, end_date FROM service ORDER BY id"
        ):
            t.services.append((weekdays, start, end))
        for sid, date, added in db.execute("SELECT service_id, date, added FROM service_exception"):
            t.exceptions.setdefault(sid, {})[date] = added == 1
    finally:
        db.close()
    return t
