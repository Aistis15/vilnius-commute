"""Walking directions: OSRM's foot route as a path and its turns, from a
recorded answer (ISM, Gedimino pr. 7 -> V. Kudirkos aikštė, 2026-09-27)."""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vc import walking  # noqa: E402

RECORDED = json.loads((Path(__file__).parent / "fixtures" / "osrm_foot_ism_kudirkos.json").read_text("utf-8"))


class Turns(unittest.TestCase):

    def test_angle_is_signed_and_short(self):
        self.assertEqual(walking.turn_angle(199, 286), 87)      # right
        self.assertEqual(walking.turn_angle(286, 16), 90)       # right, across north
        self.assertEqual(walking.turn_angle(16, 286), -90)      # left, across north
        self.assertEqual(walking.turn_angle(10, 190), -180)     # straight back

    def test_recorded_route(self):
        found = walking.parse(RECORDED)
        self.assertAlmostEqual(found["metres"], 220, delta=6)
        self.assertEqual(len(found["coords"]), len(found["along"]))
        self.assertEqual(found["along"][0], 0)
        # Right onto Gedimino pr., right onto V. Kudirkos a., then left; the
        # sharp left onto a 2 m step before arriving is noise, not a turn.
        self.assertEqual([t["name"] for t in found["turns"]], ["Gedimino pr.", "V. Kudirkos a.", ""])
        self.assertEqual([t["angle"] > 0 for t in found["turns"]], [True, True, False])
        ats = [t["at"] for t in found["turns"]]
        self.assertEqual(ats, sorted(ats))
        self.assertLess(ats[-1], found["metres"])

    def test_crossings_on_the_path_by_node(self):
        from vc import crossings
        found = walking.parse(RECORDED)
        self.assertEqual(len(found["nodes"]), len(found["coords"]))
        # Pretend the fifth node of the path is a zebra over Gedimino pr. and
        # the sixth its other half across a traffic island: one crossing.
        index = {found["nodes"][4]: (0, 0, "marked", "Gedimino pr."), found["nodes"][5]: (0, 0, "marked", "")}
        on = crossings.on_route(found, found["nodes"], index)
        self.assertEqual(len(on), 1 if found["along"][5] - found["along"][4] < crossings.SAME_CROSSING_M else 2)
        self.assertEqual((on[0]["kind"], on[0]["road"]), ("marked", "Gedimino pr."))
        self.assertAlmostEqual(on[0]["at"], found["along"][4], delta=0.2)
        self.assertEqual(crossings.on_route(found, found["nodes"], {}), [])

    def test_the_path_starts_at_the_door(self):
        # The router began on the pavement 23 m from ISM's door; the path is
        # joined on to where the walk really starts, and everything along it
        # moves up by as much. The stop end was 0.6 m off: left as it is.
        plain = walking.parse(json.loads(json.dumps(RECORDED)))
        found = walking.route(54.68688, 25.2827, 54.6871995, 25.2796912, fetch=lambda *a: json.loads(json.dumps(RECORDED)))
        self.assertEqual(found["coords"][0], [54.68688, 25.2827])
        shift = found["along"][1]
        self.assertAlmostEqual(shift, 22.9, delta=1)
        self.assertEqual(len(found["coords"]), len(plain["coords"]) + 1)
        self.assertEqual(len(found["nodes"]), len(found["coords"]))
        self.assertAlmostEqual(found["turns"][0]["at"], plain["turns"][0]["at"] + shift, delta=0.2)
        self.assertEqual(found["coords"][-1], plain["coords"][-1])

    def test_no_route(self):
        self.assertIsNone(walking.parse({"code": "NoRoute", "routes": []}))

    def test_offline_is_none(self):
        def offline(*args):
            raise OSError("offline")
        self.assertIsNone(walking.route(54.1, 25.1, 54.2, 25.2, fetch=offline))


if __name__ == "__main__":
    unittest.main()
