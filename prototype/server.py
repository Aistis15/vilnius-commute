"""Vilnius Commute prototype — run it and open http://localhost:8765

    python prototype/server.py

Standard library only: nothing to install. The first start downloads the
timetables of five cities (about 6.7 MB) from the project's GitHub release;
after that it works offline except for address search and speech, which need
the internet.
"""

from __future__ import annotations

import json
import mimetypes
import sys
import threading
import traceback
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, str(Path(__file__).resolve().parent))

from vc import data, planner, search, speech_lt  # noqa: E402

PORT = 8765
WEB = Path(__file__).resolve().parent / "web"


class State:
    timetable = None
    index = None
    manifest: dict = {}
    error: str | None = None


def load_in_background() -> None:
    try:
        State.manifest = data.ensure_database()
        State.timetable = data.load_timetable()
        State.index = search.StopIndex(State.timetable)
        print(f"Ready: {len(State.timetable.stop_names)} stops. Open http://localhost:{PORT}")
    except Exception as error:  # noqa: BLE001
        State.error = str(error)
        traceback.print_exc()


def point(value: str, name: str) -> planner.Point:
    lat, lon = (float(x) for x in value.split(","))
    return planner.Point(lat, lon, name)


def position(query: dict) -> tuple[float | None, float | None]:
    """Where the person is, to bias search towards; (None, None) when unknown."""
    if query.get("lat") and query.get("lon"):
        return float(query["lat"]), float(query["lon"])
    return None, None


def local_time(value: str) -> datetime:
    """An ISO time as the planner's clock: Vilnius wall-clock time, naive.
    "at" and "now" come without an offset; one with an offset is converted
    to this computer's local time."""
    moment = datetime.fromisoformat(value)
    if moment.tzinfo is not None:
        moment = moment.astimezone().replace(tzinfo=None)
    return moment


def minutes_of(now: str | None) -> int | None:
    if not now:
        return None
    hours, mins = now.split(":")
    return int(hours) * 60 + int(mins)


class Handler(BaseHTTPRequestHandler):

    def log_message(self, fmt, *args):  # quieter console
        if "/api/" in self.path:
            sys.stderr.write("%s %s\n" % (self.command, self.path.split("?")[0]))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urlparse(self.path)
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/api/status":
                return self.send_json({
                    "ready": State.timetable is not None,
                    "error": State.error,
                    "built_at": State.manifest.get("built_at"),
                    "stops": State.manifest.get("stops"),
                })
            if url.path == "/api/parse":
                return self.send_json(speech_lt.parse(query.get("text", ""), minutes_of(query.get("now"))).as_json())
            if url.path.startswith("/api/") and State.timetable is None:
                return self.send_json({"error": State.error or "Tvarkaraščiai dar kraunami…"}, 503)
            if url.path == "/api/search":
                # {"results": [...], "ambiguous": bool}; each result carries
                # match and confidence so the app can ask rather than guess.
                return self.send_json(search.search(State.index, query.get("q", ""), *position(query)))
            if url.path == "/api/resolve":
                # A spoken request in one call: parse it, then search every
                # reading of the destination and keep the clearest.
                parsed = speech_lt.parse(query.get("text", ""), minutes_of(query.get("now")))
                found = {"results": [], "ambiguous": False, "query": None}
                if parsed.destination and not parsed.home:
                    found = search.resolve(State.index, parsed.candidates or [parsed.destination], *position(query))
                return self.send_json({"parsed": parsed.as_json(), **found})
            if url.path == "/api/plan":
                # "now" (optional, like "at"): with mode=arrive, trips that
                # should already have started are dropped, and when none is
                # left the answer says "late" and by how many minutes.
                result = planner.plan(
                    State.timetable,
                    point(query["from"], query.get("from_name", "Tavo vieta")),
                    point(query["to"], query.get("to_name", "Tikslas")),
                    local_time(query["at"]),
                    query.get("mode") == "arrive",
                    query.get("priority", "fastest"),
                    query.get("walk", "normal"),
                    now=local_time(query["now"]) if query.get("now") else None,
                )
                return self.send_json(result)
            if url.path.startswith("/api/"):
                return self.send_json({"error": "unknown endpoint"}, 404)
            return self.serve_static(url.path)
        except (KeyError, ValueError) as error:
            return self.send_json({"error": f"Blogas užklausos parametras: {error}"}, 400)
        except Exception as error:  # noqa: BLE001
            traceback.print_exc()
            return self.send_json({"error": str(error)}, 500)

    def serve_static(self, path: str):
        target = (WEB / (path.lstrip("/") or "index.html")).resolve()
        if WEB not in target.parents and target != WEB / "index.html" or not target.is_file():
            target = WEB / "index.html"
        body = target.read_bytes()
        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if kind.startswith("text/") or kind in ("application/javascript", "text/javascript"):
            kind += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    mimetypes.add_type("application/javascript", ".js")
    threading.Thread(target=load_in_background, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"Vilnius Commute prototype on http://localhost:{PORT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
