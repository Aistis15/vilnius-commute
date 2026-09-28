"""The streets lines drive: polylines as the database stores them, stops
placed along a line, and a vehicle pulled onto its street."""

import importlib.util
import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vc import shapes  # noqa: E402

# The database's builder, which writes the polylines this module reads.
_spec = importlib.util.spec_from_file_location(
    "build_db", Path(__file__).resolve().parents[2] / "Tools" / "gtfs" / "build_db.py")
build_db = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(build_db)

LAT0, LON0 = 54.68, 25.28
EAST = 1 / (111_320 * math.cos(math.radians(LAT0)))    # degrees per metre east
NORTH = 1 / 110_540                                      # degrees per metre north


def at(east_m: float, north_m: float) -> tuple[float, float]:
    return LAT0 + north_m * NORTH, LON0 + east_m * EAST


class Polyline(unittest.TestCase):

    def test_googles_own_example(self):
        self.assertEqual(shapes.decode("_p~iF~ps|U_ulLnnqC_mqNvxq`@"),
                         [(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)])

    def test_what_the_builder_writes_reads_back(self):
        points = [(54.68688, 25.2827), (54.687, 25.283), (54.6865, 25.281)]
        self.assertEqual(shapes.decode(build_db.encode_polyline(points)), points)

    def test_thinning_keeps_the_corners(self):
        # A straight street with a point every 10 m, then a corner.
        line = [at(x, 0) for x in range(0, 301, 10)] + [at(300, y) for y in range(10, 201, 10)]
        thin = build_db.thin(line)
        self.assertEqual(thin, [line[0], at(300, 0), line[-1]])


class Placing(unittest.TestCase):
    """An L: 300 m east, then 200 m north. Stops at the start, the corner
    and the end, each a few metres to the side of the street."""

    def setUp(self):
        self.shape = shapes.build([at(0, 0), at(300, 0), at(300, 200)],
                                  [at(0, 5), at(300, -4), at(303, 200)])

    def test_length(self):
        self.assertAlmostEqual(self.shape.length, 500, delta=1)

    def test_stops_along_it(self):
        for got, want in zip(self.shape.stop_m, (0, 300, 500)):
            self.assertAlmostEqual(got, want, delta=1)

    def test_a_point_along_it(self):
        lat, lon = self.shape.point_at(400)
        self.assertAlmostEqual((lat - LAT0) / NORTH, 100, delta=1)
        self.assertAlmostEqual((lon - LON0) / EAST, 300, delta=1)

    def test_a_ride_cut_out_of_it(self):
        line = self.shape.cut(100, 400)
        self.assertEqual(len(line), 3)                 # its start, the corner, its end
        self.assertAlmostEqual((line[1][1] - LON0) / EAST, 300, delta=0.5)

    def test_a_vehicle_off_the_kerb_is_put_on_it(self):
        m, off = self.shape.locate(*at(150, 8))
        self.assertAlmostEqual(m, 150, delta=1)
        self.assertAlmostEqual(off, 8, delta=0.5)

    def test_a_line_that_passes_one_place_twice(self):
        # Out along one street and back along the next one, 20 m away: the
        # last stop, beside the first, belongs to the way back.
        loop = shapes.build([at(0, 0), at(300, 0), at(300, 20), at(0, 20)],
                            [at(0, -3), at(300, -3), at(0, 23)])
        self.assertAlmostEqual(loop.stop_m[2], 620, delta=1)


class OnItsStreet(unittest.TestCase):

    class Timetable:
        stop_lat, stop_lon = zip(at(0, 0), at(300, 0), at(300, 200))
        pattern_stops = [[0, 1, 2]]
        pattern_polyline = [build_db.encode_polyline([at(0, 0), at(300, 0), at(300, 200)])]

    def setUp(self):
        self.streets = shapes.Shapes(self.Timetable())

    def test_near_its_street_it_is_on_it(self):
        self.assertAlmostEqual(self.streets.place(0, *at(120, 12), near_stop=0), 120, delta=1)

    def test_far_from_it_it_is_not(self):
        self.assertIsNone(self.streets.place(0, *at(120, 60), near_stop=0))

    def test_a_ride_is_its_street_and_its_stops(self):
        ride = self.streets.ride(0, 1, 2)
        self.assertEqual(len(ride["coords"]), 2)
        self.assertEqual(ride["stops"][0], 0)
        self.assertAlmostEqual(ride["stops"][1], 200, delta=1)


if __name__ == "__main__":
    unittest.main()
