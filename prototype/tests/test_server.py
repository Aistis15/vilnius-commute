"""The endpoints over HTTP: search offline (recorded Photon, sampled stops),
planning on the real timetable when it has been downloaded."""

import json
import threading
import unittest
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from http.server import ThreadingHTTPServer
from unittest import mock

import server
from vc import search
from tests.test_planner import AKROPOLIS, ISM, TIMETABLE, busy_weekday
from tests.test_search import KAUNAS, fake_photon, vilnius_index


class Endpoints(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.quiet = mock.patch.object(server.Handler, "log_message", lambda *args: None)
        cls.quiet.start()
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.quiet.stop()

    def setUp(self):
        search._cache.clear()
        fake_photon.origins = []
        for target, value in ((server.State, "timetable"), (server.State, "index")):
            original = getattr(target, value)
            self.addCleanup(setattr, target, value, original)
        server.State.timetable = object()
        # Vilnius's sampled stops and one in Kaunas: places are offered only
        # where some stop is within reach.
        server.State.index = vilnius_index([("Karaliaus Mindaugo pr.", "Kaunas", *KAUNAS)])
        patcher = mock.patch.object(search, "_fetch_photon", fake_photon)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(search._cache.clear)

    def get(self, path, **params):
        with urllib.request.urlopen(f"{self.base}{path}?{urllib.parse.urlencode(params)}", timeout=5) as response:
            return json.loads(response.read())

    def test_search_passes_position_through(self):
        body = self.get("/api/search", q="Akropolis", lat=KAUNAS[0], lon=KAUNAS[1])
        self.assertEqual(fake_photon.origins, [KAUNAS])
        self.assertEqual(body["results"][0]["city"], "Kaunas")
        self.assertIs(body["ambiguous"], False)

    def test_places_outside_the_cities_are_not_offered(self):
        # Photon finds an Akropolis in Šiauliai too; the app plans in
        # Vilnius, Kaunas and Klaipėda only, so it is not a result.
        body = self.get("/api/search", q="Akropolis")
        cities = {r.get("city") for r in body["results"]}
        self.assertIn("Vilnius", cities)
        self.assertNotIn("Šiauliai", cities)

    def test_search_defaults_to_vilnius(self):
        body = self.get("/api/search", q="ISM universitetas")
        self.assertEqual(fake_photon.origins, [search.VILNIUS])
        self.assertEqual(body["results"][0]["confidence"], "high")

    def test_resolve_spelled_letters(self):
        body = self.get("/api/resolve", text="man reikia į i s m universitetą", now="10:00")
        self.assertEqual(body["parsed"]["candidates"][0], "ISM universitetas")
        self.assertEqual(body["query"], "ISM universitetas")
        self.assertEqual(body["results"][0]["name"], "ISM Vadybos ir ekonomikos universitetas")

    def test_parse_keeps_its_shape(self):
        body = self.get("/api/parse", text="Man reikia į Akropolį keturiolika dvidešimt", now="10:00")
        self.assertTrue({"text", "destination", "candidates", "time", "mode", "then", "home", "now"} <= body.keys())
        self.assertEqual((body["candidates"][0], body["time"]), ("Akropolis", "14:20"))

    def test_plan_passes_now_through(self):
        calls = []

        def fake_plan(*args, **kwargs):
            calls.append((args, kwargs))
            return {"options": [], "late": False, "late_by_min": None}

        trip = {"from": "54.68688,25.2827", "to": "54.71051,25.26314", "at": "2026-09-28T09:00:00", "mode": "arrive"}
        with mock.patch.object(server.planner, "plan", fake_plan):
            self.get("/api/plan", **trip, now="2026-09-28T08:58:00")
            self.get("/api/plan", **trip)
        (args, kwargs), (_, without) = calls
        self.assertEqual((args[3], args[4]), (datetime(2026, 9, 28, 9, 0), True))
        self.assertEqual(kwargs["now"], datetime(2026, 9, 28, 8, 58))
        self.assertIsNone(without["now"])

    @unittest.skipIf(TIMETABLE is None, "timetable not downloaded yet")
    def test_plan_says_late(self):
        server.State.timetable = TIMETABLE
        deadline = busy_weekday().replace(hour=9)
        body = self.get("/api/plan", **{
            "from": f"{ISM.lat},{ISM.lon}", "to": f"{AKROPOLIS.lat},{AKROPOLIS.lon}",
            "at": deadline.isoformat(), "mode": "arrive",
            "now": (deadline - timedelta(minutes=2)).isoformat(),
        })
        self.assertIs(body["late"], True)
        self.assertGreater(body["late_by_min"], 0)
        self.assertTrue(body["options"])
        self.assertTrue(all(o["late"] for o in body["options"]))
        self.assertGreater(body["options"][0]["arrive"]["iso"], deadline.isoformat())


if __name__ == "__main__":
    unittest.main()
