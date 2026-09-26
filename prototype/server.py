"""Vilnius Commute prototype — run it and open http://localhost:8765

    python prototype/server.py

Standard library only: nothing to install. The first start downloads the
timetable (about 3 MB) from the project's GitHub release; after that it works
offline except for address search and speech, which need the internet.
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
                now = query.get("now")
                minutes = None
                if now:
                    hours, mins = now.split(":")
                    minutes = int(hours) * 60 + int(mins)
                return self.send_json(speech_lt.parse(query.get("text", ""), minutes).as_json())
            if url.path.startswith("/api/") and State.timetable is None:
                return self.send_json({"error": State.error or "Tvarkaraščiai dar kraunami…"}, 503)
            if url.path == "/api/search":
                return self.send_json({"results": search.search(State.index, query.get("q", ""))})
            if url.path == "/api/plan":
                result = planner.plan(
                    State.timetable,
                    point(query["from"], query.get("from_name", "Tavo vieta")),
                    point(query["to"], query.get("to_name", "Tikslas")),
                    datetime.fromisoformat(query["at"]),
                    query.get("mode") == "arrive",
                    query.get("priority", "fastest"),
                    query.get("walk", "normal"),
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
