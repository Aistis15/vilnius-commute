"""Demo mode: buses where the timetable puts them (vc/demo.py)."""

import sys
import unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vc import demo  # noqa: E402
from tests.test_live import line_10  # noqa: E402


def at(hour, minute, second=0):
    return lambda: datetime(2026, 9, 28, hour, minute, second)


class Scheduled(unittest.TestCase):

    def test_bus_between_its_stops(self):
        # 08:04:30 on the 08:00 trip: left Rotušė (08:03), half way to Katedra.
        source = demo.ScheduledLive(line_10(), clock=at(8, 4, 30))
        [vehicle] = source.vehicles("Vilnius")
        self.assertEqual(vehicle.trip, (0, 0))
        self.assertAlmostEqual(vehicle.lat, (54.6780 + 54.6860) / 2, places=4)
        self.assertEqual(vehicle.delay, 0)

    def test_none_before_the_first_or_after_the_last(self):
        self.assertEqual(demo.ScheduledLive(line_10(), clock=at(7, 59)).vehicles("Vilnius"), [])
        self.assertEqual(demo.ScheduledLive(line_10(), clock=at(8, 10)).vehicles("Vilnius"), [])

    def test_late_on_cue(self):
        source = demo.ScheduledLive(line_10(), clock=at(8, 4, 30))
        source.set_delay(0, 0, 180)
        [vehicle] = source.vehicles("Vilnius")
        self.assertEqual(vehicle.delay, 180)
        # Three minutes behind: half way from Stotis to Rotušė.
        self.assertAlmostEqual(vehicle.lat, (54.6700 + 54.6780) / 2, places=4)
        state = source.leg_state(0, 0, 0, 2, 3, datetime(2026, 9, 28), at(8, 4, 30)())
        self.assertEqual(state["delay_s"], 180)
        self.assertEqual(state["expected"]["hm"], "08:09")

    def test_parse_clock(self):
        self.assertEqual(demo.parse_clock("8:15", datetime(2026, 10, 9, 21, 3)), datetime(2026, 10, 9, 8, 15))


if __name__ == "__main__":
    unittest.main()
