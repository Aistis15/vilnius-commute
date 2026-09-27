"""Live vehicles: parsing stops.lt's feeds, matching them to trips, and what
the app is told (delay, expected times, how many stops away). No network: a
four-stop line and hand-written feed rows."""

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vc import departures, live  # noqa: E402
from vc.data import Route, Timetable  # noqa: E402

MIN = 60


def line_10() -> Timetable:
    """Line 10, four stops three minutes apart, trips at 08:00 and 08:30,
    running every day of 2026. Stop 3 is on the far side of town."""
    t = Timetable()
    t.stop_names = ["Stotis", "Rotušė", "Katedra", "Žirmūnai"]
    t.stop_lat = [54.6700, 54.6780, 54.6860, 54.7100]
    t.stop_lon = [25.2800, 25.2840, 25.2880, 25.2950]
    t.stop_city = ["Vilnius"] * 4
    t.routes = [Route(id=0, short_name="10", category="bus", color="0073AC", text_color="FFFFFF")]
    t.pattern_route = [0]
    t.pattern_headsign = ["Žirmūnai"]
    t.pattern_stops = [[0, 1, 2, 3]]
    trip = lambda start: (0, [start + k * 3 * MIN for k in range(4)], [start + k * 3 * MIN for k in range(4)])  # noqa: E731
    t.pattern_trips = [[trip(8 * 3600), trip(8 * 3600 + 30 * MIN)]]
    t.pattern_trip_ids = [["vilnius:T0800", "vilnius:T0830"]]
    t.patterns_at_stop = [[(0, i)] for i in range(4)]
    t.transfers = [[] for _ in range(4)]
    t.services = [(0b1111111, 20260101, 20261231)]
    return t


HEADER = ("Transportas,Marsrutas,ReisoID,MasinosNumeris,Ilguma,Platuma,Greitis,Azimutas,"
          "ReisoPradziaMinutemis,NuokrypisSekundemis,MatavimoLaikas,MasinosTipas,KryptiesTipas,"
          "KryptiesPavadinimas,ReisoIdGTFS,IntervalasPries,IntervalasPaskui,")
KAUNAS_HEADER = ("Transportas,Marsrutas,Grafikas,MasinosNumeris,Ilguma,Platuma,Greitis,Azimutas,"
                 "ReisoPradziaMinutemis,NuokrypisSekundemis,SekanciosStotelesNum,AtvykimoLaikasSekundemis,"
                 "KryptiesPavadinimas,")
AT = datetime(2026, 9, 28, 8, 4)      # a Monday, four minutes into the 08:00 trip


def vilnius_feed(delay=120, measured=8 * 3600 + 4 * MIN, trip="T0800"):
    return (HEADER + "\n"
            f"Autobusai,10,1,573,25284000,54678000,20,10,480,{delay},{measured},KWNZ,A>B,Žirmūnai,{trip},0,0,\n")


class Parsing(unittest.TestCase):

    def test_full_feed_row(self):
        rows = live.parse_full(vilnius_feed(), 8 * 3600 + 5 * MIN)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual((row["route"], row["delay"], row["gtfs_trip"]), ("10", 120, "T0800"))
        self.assertAlmostEqual(row["lat"], 54.678)
        self.assertAlmostEqual(row["lon"], 25.284)
        self.assertFalse(row["trolleybus"])

    def test_a_vehicle_silent_for_minutes_is_not_on_the_road(self):
        rows = live.parse_full(vilnius_feed(measured=8 * 3600), 8 * 3600 + 10 * MIN)
        self.assertEqual(rows, [])

    def test_positions_only_feed(self):
        rows = live.parse_positions("2,8,24346966,55750786,0,342,,2187,\n2,,24377134,55715252,0,66,,2212,\n")
        self.assertEqual([r["route"] for r in rows], ["8"])     # no route: going to the depot
        self.assertIsNone(rows[0]["delay"])


class Matching(unittest.TestCase):

    def setUp(self):
        self.t = line_10()
        self.matcher = live.Matcher(self.t)
        self.today = (20260928, 0)
        self.yesterday = (20260927, 6)

    def row(self, **over):
        base = {"route": "10", "trolleybus": False, "lat": 54.678, "lon": 25.284, "bearing": 0,
                "delay": 60, "start": 480, "gtfs_trip": "", "headsign": "Žirmūnai", "number": "1"}
        return {**base, **over}

    def test_by_gtfs_trip_id(self):
        found = self.matcher.match("Vilnius", self.row(gtfs_trip="T0830"), self.today, self.yesterday, 0)
        self.assertEqual(found, (0, 1))

    def test_by_route_and_start_minute(self):
        found = self.matcher.match("Vilnius", self.row(start=510), self.today, self.yesterday, 0)
        self.assertEqual(found, (0, 1))

    def test_a_trolleybus_is_not_the_bus_of_the_same_number(self):
        found = self.matcher.match("Vilnius", self.row(trolleybus=True), self.today, self.yesterday, 0)
        self.assertIsNone(found)

    def test_without_a_delay_there_is_nothing_to_tell(self):
        self.assertIsNone(self.matcher.match("Vilnius", self.row(delay=None), self.today, self.yesterday, 0))


class RideState(unittest.TestCase):

    def live(self, text):
        return live.Live(line_10(), fetch=lambda url: text, clock=lambda: AT)

    def test_late_bus(self):
        # Two minutes late, four minutes into the trip: it left Stotis at
        # 08:02 and reaches Rotušė at 08:05, so boarding at Katedra (index 2)
        # it is two stops away and leaves there at 08:08 instead of 08:06.
        state = self.live(vilnius_feed(delay=120)).ride_state([0, 0, 0, 2, 3, "2026-09-28"], AT)
        self.assertEqual(state["delay_s"], 120)
        self.assertEqual(state["expected"]["hm"], "08:08")
        self.assertEqual(state["expected_arrival"]["hm"], "08:11")
        self.assertEqual(state["stops_away"], 2)
        self.assertFalse(state["departed"])

    def test_a_bus_that_has_passed_the_stop(self):
        state = self.live(vilnius_feed(delay=0)).ride_state([0, 0, 0, 0, 3, "2026-09-28"], AT)
        self.assertTrue(state["departed"])

    def test_no_vehicle_no_state(self):
        state = self.live(vilnius_feed(trip="T9999")).ride_state([0, 0, 0, 2, 3, "2026-09-28"], AT)
        self.assertIsNone(state)

    def test_a_ride_hours_away_is_not_this_bus(self):
        state = self.live(vilnius_feed()).ride_state([0, 0, 0, 2, 3, "2026-09-29"], AT)
        self.assertIsNone(state)

    def test_a_city_without_a_feed(self):
        feeds = self.live(vilnius_feed())
        self.assertIsNone(feeds.vehicles("Šiauliai"))

    def test_a_feed_that_fails_is_no_live_data_not_an_error(self):
        def broken(url):
            raise OSError("offline")
        feeds = live.Live(line_10(), fetch=broken, clock=lambda: AT)
        self.assertIsNone(feeds.ride_state([0, 0, 0, 2, 3, "2026-09-28"], AT))


class Board(unittest.TestCase):

    def test_departures_near_a_stop_with_a_live_delay(self):
        t = line_10()
        feeds = live.Live(t, fetch=lambda url: vilnius_feed(delay=120), clock=lambda: AT)
        board = departures.nearby(t, 54.6860, 25.2880, AT, feeds)     # at Katedra
        katedra = next(s for s in board["stops"] if s["name"] == "Katedra")
        times = katedra["lines"][0]["departures"]
        self.assertEqual(katedra["lines"][0]["headsign"], "Žirmūnai")
        self.assertEqual((times[0]["hm"], times[0]["scheduled"], times[0]["live"]), ("08:08", "08:06", True))
        self.assertEqual((times[1]["hm"], times[1]["live"]), ("08:36", False))

    def test_a_line_that_ends_here_takes_nobody_away(self):
        t = line_10()
        board = departures.nearby(t, 54.7100, 25.2950, AT, None)      # at Žirmūnai, the last stop
        zirmunai = next(s for s in board["stops"] if s["name"] == "Žirmūnai")
        self.assertEqual(zirmunai["lines"], [])


if __name__ == "__main__":
    unittest.main()
