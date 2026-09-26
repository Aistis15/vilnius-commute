"""The search endpoints over HTTP, offline: recorded Photon, sampled stops."""

import json
import threading
import unittest
import urllib.parse
import urllib.request
from http.server import ThreadingHTTPServer
from unittest import mock

import server
from vc import search
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
        server.State.index = vilnius_index()
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


if __name__ == "__main__":
    unittest.main()
