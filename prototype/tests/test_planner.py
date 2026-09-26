"""Planner properties on the real Vilnius timetable.

Like the Swift routing tests, nothing here pins a trip or a clock time: the
data is rebuilt daily. Each test asserts something that must hold whatever
the timetable says. Skipped when the database has not been downloaded yet.
"""

import unittest
from datetime import datetime, timedelta

from vc import data
from vc.planner import Point, plan

TIMETABLE = data.load_timetable() if data.DB_PATH.exists() else None

ISM = Point(54.68688, 25.2827, "ISM")                 # Gedimino pr. 7
AKROPOLIS = Point(54.71051, 25.26314, "Akropolis")    # Ozo g. 25


def busy_weekday() -> datetime:
    """A weekday inside the feed's coverage, found from the data."""
    day = datetime.now().replace(hour=8, minute=0, second=0, microsecond=0)
    for _ in range(14):
        date = day.year * 10_000 + day.month * 100 + day.day
        running = sum(TIMETABLE.runs(s, date, day.weekday()) for s in range(len(TIMETABLE.services)))
        if day.weekday() < 5 and running:
            return day
        day += timedelta(days=1)
    return day


@unittest.skipIf(TIMETABLE is None, "timetable not downloaded yet")
class Planner(unittest.TestCase):

    def test_finds_trips_and_never_leaves_before_asked(self):
        when = busy_weekday()
        result = plan(TIMETABLE, ISM, AKROPOLIS, when, arrive_by=False)
        transit = [o for o in result["options"] if not o["walk_only"]]
        self.assertTrue(transit, "no transit option between ISM and Akropolis on a weekday morning")
        asked = (when - when.replace(hour=0, minute=0)).seconds
        for option in transit:
            self.assertGreaterEqual(option["leave_s"], asked)

    def test_arrive_by_is_never_late(self):
        when = busy_weekday().replace(hour=9)
        deadline = 9 * 3600
        result = plan(TIMETABLE, ISM, AKROPOLIS, when, arrive_by=True)
        self.assertTrue(result["options"])
        for option in result["options"]:
            self.assertLessEqual(option["arrive_s"], deadline)

    def test_legs_chain_without_time_travel(self):
        result = plan(TIMETABLE, ISM, AKROPOLIS, busy_weekday(), arrive_by=False)
        for option in result["options"]:
            legs = option["legs"]
            for a, b in zip(legs, legs[1:]):
                self.assertLessEqual(a["arrival"]["iso"], b["departure"]["iso"])
            self.assertEqual(legs[0]["from"]["name"], "ISM")
            self.assertEqual(legs[-1]["to"]["name"], "Akropolis")

    def test_close_places_offer_a_walk(self):
        near = Point(ISM.lat + 0.004, ISM.lon, "Netoliese")   # about 450 m north
        result = plan(TIMETABLE, ISM, near, busy_weekday(), arrive_by=False)
        self.assertTrue(any(o["walk_only"] for o in result["options"]))

    def test_no_pointless_extra_changes(self):
        """An option with more changes must arrive at least 3 minutes sooner
        than every option with fewer, or leave noticeably later."""
        result = plan(TIMETABLE, ISM, AKROPOLIS, busy_weekday(), arrive_by=False)
        options = [o for o in result["options"] if not o["walk_only"]]
        for a in options:
            for b in options:
                if a["transfers"] > b["transfers"] and a["leave_s"] <= b["leave_s"] + 300:
                    self.assertLess(a["arrive_s"], b["arrive_s"] - 60,
                                    f"{a['id']} adds changes for nothing over {b['id']}")


if __name__ == "__main__":
    unittest.main()
