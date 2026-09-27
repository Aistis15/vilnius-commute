"""Planner properties on the real Vilnius timetable.

Like the Swift routing tests, nothing here pins a trip or a clock time: the
data is rebuilt daily. Each test asserts something that must hold whatever
the timetable says. Skipped when the database has not been downloaded yet.
"""

import math
import unittest
from datetime import datetime, timedelta

from vc import data
from vc.planner import EXTRA_STOPS, Point, intercity_patterns, plan, stops_near, usable_patterns
from vc.router import DESTINATION, ORIGIN, Access, Leg, Router, merge_walks

TIMETABLE = data.load_timetable() if data.DB_PATH.exists() else None

ISM = Point(54.68688, 25.2827, "ISM")                 # Gedimino pr. 7
AKROPOLIS = Point(54.71051, 25.26314, "Akropolis")    # Ozo g. 25
# Where search puts "Stotis" in Vilnius (the middle of its platforms), and a
# Šiauliai city stop 300 m from the bus station there.
STOTIS = Point(54.67104, 25.28376, "Stotis")
SIAULIAI = Point(55.93047, 23.30905, "Dvaro st.")
ZALIASIS_TILTAS = Point(54.6922, 25.2802, "Žaliasis tiltas")


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

    def test_never_two_walks_in_a_row(self):
        # Off the bus, across to another stop and on to the destination on
        # foot is one walk, with the time and metres of both parts.
        when = busy_weekday()
        for origin, destination in ((ISM, AKROPOLIS), (AKROPOLIS, STOTIS), (ZALIASIS_TILTAS, ISM)):
            for arrive_by in (False, True):
                result = plan(TIMETABLE, origin, destination, when, arrive_by=arrive_by)
                for option in result["options"]:
                    kinds = [leg["kind"] for leg in option["legs"]]
                    with self.subTest(trip=f"{origin.name}-{destination.name}", arrive_by=arrive_by, id=option["id"]):
                        self.assertNotIn(("walk", "walk"), list(zip(kinds, kinds[1:])))
                        self.assertEqual(option["walk_m"], sum(leg["metres"] for leg in option["legs"] if leg["kind"] == "walk"))


def seconds_of(moment: datetime) -> int:
    return moment.hour * 3600 + moment.minute * 60 + moment.second


@unittest.skipIf(TIMETABLE is None, "timetable not downloaded yet")
class NearbyStops(unittest.TestCase):
    """The dozen nearest platforms, and any farther one with a line of its own."""

    POINTS = (STOTIS, ISM, AKROPOLIS, ZALIASIS_TILTAS)

    def test_a_farther_stop_is_kept_only_for_a_line_of_its_own(self):
        for point in self.POINTS:
            for role in ("origin", "destination"):
                kept = stops_near(TIMETABLE, point, 800, role=role)
                coaches = intercity_patterns(TIMETABLE)
                served, extra = set(), 0
                for rank, access in enumerate(kept):
                    usable = usable_patterns(TIMETABLE, access.stop, role)
                    new = usable - served
                    if rank >= 12:
                        with self.subTest(point=point.name, role=role, stop=access.stop):
                            self.assertTrue(new)
                        if new.isdisjoint(coaches.get(access.stop, ())):
                            extra += 1
                    served |= usable
                self.assertLessEqual(extra, EXTRA_STOPS)

    def test_every_line_in_reach_stays_in_reach(self):
        # Unless the cap is reached, the kept stops serve every pattern that
        # all the stops within walking reach serve together.
        for point in self.POINTS:
            for role in ("origin", "destination"):
                kept = stops_near(TIMETABLE, point, 800, role=role)
                if len(kept) >= 12 + EXTRA_STOPS:
                    continue
                every = stops_near(TIMETABLE, point, 800, max_count=10_000, role=role)
                union = lambda stops: set().union(*(usable_patterns(TIMETABLE, a.stop, role) for a in stops))  # noqa: E731
                with self.subTest(point=point.name, role=role):
                    self.assertEqual(union(kept), union(every))

    def test_the_dozen_nearest_do_not_serve_all_of_stotis(self):
        # Several city lines end at a "Stotis" platform farther than the
        # twelve nearest: getting off there must stay possible.
        kept = stops_near(TIMETABLE, STOTIS, 800, role="destination")
        self.assertGreater(len(kept), 12)

    def test_a_line_that_ends_takes_nobody_away(self):
        for access in stops_near(TIMETABLE, STOTIS, 800):
            for pattern in usable_patterns(TIMETABLE, access.stop, "origin"):
                self.assertNotEqual(TIMETABLE.pattern_stops[pattern][-1], access.stop)
            for pattern in usable_patterns(TIMETABLE, access.stop, "destination"):
                self.assertNotEqual(TIMETABLE.pattern_stops[pattern][0], access.stop)


class Walks(unittest.TestCase):
    """Walks merged in the router, on a made-up three-stop network."""

    def network(self):
        # A -> X by one bus at 08:00, arriving 08:10; X and Y 200 m apart.
        return data.Timetable(
            stop_names=["A", "X", "Y"], stop_lat=[0.0, 0.0, 0.0], stop_lon=[0.0, 0.0, 0.0],
            stop_city=["Vilnius"] * 3,
            routes=[data.Route(0, "1", "bus", "0073AC", "FFFFFF")],
            pattern_route=[0], pattern_headsign=["X"], pattern_stops=[[0, 1]],
            pattern_trips=[[(0, [8 * 3600, 8 * 3600 + 600], [8 * 3600, 8 * 3600 + 600])]],
            patterns_at_stop=[[(0, 0)], [(0, 1)], []],
            transfers=[[], [(2, 200)], [(1, 200)]],
            services=[(0b1111111, 20260101, 20271231)],
        )

    def test_a_transfer_walk_then_the_walk_to_the_destination_is_one_walk(self):
        router = Router(self.network())
        # The destination is in reach of Y only: off at X, walk to Y, walk on.
        journeys = router.journeys([Access(0, 135)], [Access(2, 270)], 7 * 3600 + 50 * 60,
                                   (20260928, 0), (20260927, 6))
        self.assertEqual(len(journeys), 1)
        legs = journeys[0].legs
        self.assertEqual([leg.kind for leg in legs], ["walk", "ride", "walk"])
        last = legs[-1]
        ride_arrival = 8 * 3600 + 600
        # 200 m at 1.35 m/s is 149 s, plus the 60 s buffer at Y; 270 m is 200 s.
        self.assertEqual((last.from_stop, last.to_stop), (1, DESTINATION))
        self.assertEqual((last.departure, last.arrival, last.metres), (ride_arrival, ride_arrival + 149 + 60 + 200, 470))
        self.assertEqual(journeys[0].arrival, last.arrival)
        self.assertEqual(journeys[0].walk_metres, 135 + 470)

    def test_merge_walks(self):
        legs = [
            Leg("walk", ORIGIN, 0, 100, 200, 100),
            Leg("ride", 0, 1, 260, 900, pattern=0, trip=0, board_index=0, alight_index=1),
            Leg("walk", 1, 2, 900, 1000, 120),
            Leg("walk", 2, 3, 1000, 1100, 80),
            Leg("walk", 3, DESTINATION, 1100, 1300, 150),
        ]
        merged = merge_walks(legs)
        self.assertEqual([leg.kind for leg in merged], ["walk", "ride", "walk"])
        self.assertEqual((merged[2].from_stop, merged[2].to_stop, merged[2].departure, merged[2].arrival, merged[2].metres),
                         (1, DESTINATION, 900, 1300, 350))
        self.assertEqual(merged[:2], legs[:2])


@unittest.skipIf(TIMETABLE is None, "timetable not downloaded yet")
class ArriveByFromNow(unittest.TestCase):
    """"Be there by" asked late in the day: never a trip that has gone."""

    def test_never_offers_a_trip_that_should_have_started(self):
        deadline = busy_weekday().replace(hour=9)
        for minutes_before in (60, 40, 25, 12):
            now = deadline - timedelta(minutes=minutes_before)
            with self.subTest(now=now.strftime("%H:%M")):
                result = plan(TIMETABLE, ISM, AKROPOLIS, deadline, arrive_by=True, now=now)
                self.assertTrue(result["options"])
                for option in result["options"]:
                    self.assertGreaterEqual(option["leave_s"], seconds_of(now) - 60)
                    if not result["late"]:
                        self.assertLessEqual(option["arrive_s"], seconds_of(deadline))

    def test_too_late_offers_the_fastest_from_now(self):
        # ISM to Akropolis is 3 km: nothing gets there in two minutes.
        deadline = busy_weekday().replace(hour=9)
        now = deadline - timedelta(minutes=2)
        result = plan(TIMETABLE, ISM, AKROPOLIS, deadline, arrive_by=True, now=now)
        self.assertIs(result["late"], True)
        options = result["options"]
        self.assertTrue(options)
        best = min(o["arrive_s"] for o in options)
        self.assertEqual(result["late_by_min"], math.ceil((best - seconds_of(deadline)) / 60))
        self.assertGreater(result["late_by_min"], 0)
        self.assertEqual(options[0]["arrive_s"] + 180 * options[0]["transfers"],
                         min(o["arrive_s"] + 180 * o["transfers"] for o in options))
        for option in options:
            self.assertGreaterEqual(option["leave_s"], seconds_of(now) - 60)
            self.assertIs(option["late"], True)

    def test_in_time_says_so(self):
        deadline = busy_weekday().replace(hour=9)
        for now in (deadline - timedelta(hours=2), None):
            with self.subTest(now=now):
                result = plan(TIMETABLE, ISM, AKROPOLIS, deadline, arrive_by=True, now=now)
                self.assertEqual((result["late"], result["late_by_min"]), (False, None))
                self.assertTrue(result["options"])
                self.assertFalse([o for o in result["options"] if o["late"]])


def coach_links(origin: Point, destination: Point) -> bool:
    """Whether the data has an intercity line between walking reach of both."""
    coaches = intercity_patterns(TIMETABLE)
    near = lambda point: set().union(*(coaches.get(a.stop, ()) for a in stops_near(TIMETABLE, point, 800)))  # noqa: E731
    return bool(near(origin) & near(destination))


@unittest.skipIf(TIMETABLE is None, "timetable not downloaded yet")
class Intercity(unittest.TestCase):
    """Vilnius to Šiauliai by the coach from the bus station by "Stotis"."""

    def setUp(self):
        if not coach_links(STOTIS, SIAULIAI):
            self.skipTest("no Vilnius–Šiauliai coach in this timetable")

    def test_the_coach_stand_is_in_reach_of_the_station(self):
        # Vilnius AS is farther than the dozen nearest "Stotis" platforms.
        coaches = intercity_patterns(TIMETABLE)
        self.assertTrue(any(coaches.get(a.stop) for a in stops_near(TIMETABLE, STOTIS, 800)))

    def test_takes_the_coach_straight_away(self):
        result = plan(TIMETABLE, STOTIS, SIAULIAI, busy_weekday().replace(hour=7), arrive_by=False)
        transit = [o for o in result["options"] if not o["walk_only"]]
        self.assertTrue(transit, "no option from Vilnius Stotis to Šiauliai")
        # Not a city bus away from the station first, to walk back to it.
        self.assertEqual(transit[0]["transfers"], 0)

    def test_arrive_by_looks_back_further_than_a_city_trip(self):
        when = busy_weekday().replace(hour=7)
        depart = plan(TIMETABLE, STOTIS, SIAULIAI, when, arrive_by=False)
        first = min(o["arrive_s"] for o in depart["options"] if not o["walk_only"])
        deadline = when.replace(hour=0) + timedelta(minutes=math.ceil(first / 60))
        result = plan(TIMETABLE, STOTIS, SIAULIAI, deadline, arrive_by=True)
        transit = [o for o in result["options"] if not o["walk_only"]]
        self.assertTrue(transit, "arrive-by found nothing although the coach runs")
        for option in transit:
            self.assertLessEqual(option["arrive_s"], seconds_of(deadline))
            # The coach takes longer than the three hours a city trip gets.
            self.assertGreater(seconds_of(deadline) - option["leave_s"], 3 * 3600)

    def test_too_late_for_the_coach(self):
        # 190 km in an hour: never. The answer is the first way from now.
        deadline = busy_weekday().replace(hour=7)
        now = deadline - timedelta(hours=1)
        result = plan(TIMETABLE, STOTIS, SIAULIAI, deadline, arrive_by=True, now=now)
        self.assertIs(result["late"], True)
        self.assertGreater(result["late_by_min"], 60)
        for option in result["options"]:
            self.assertGreaterEqual(option["leave_s"], seconds_of(now) - 60)


if __name__ == "__main__":
    unittest.main()


@unittest.skipIf(TIMETABLE is None, "timetable not downloaded yet")
class Cities(unittest.TestCase):
    """Trips are planned inside a city; the app says so when they are not."""

    KAUNAS = Point(54.8966, 23.8905, "Kauno pilis")

    def test_another_city_is_flagged_not_just_empty(self):
        from vc.planner import city_at
        if city_at(TIMETABLE, self.KAUNAS.lat, self.KAUNAS.lon) != "Kaunas":
            self.skipTest("this timetable has no Kaunas")
        result = plan(TIMETABLE, ISM, self.KAUNAS, busy_weekday(), arrive_by=False)
        self.assertIs(result["cross_city"], True)
        self.assertEqual((result["from_city"], result["to_city"]), ("Vilnius", "Kaunas"))

    def test_same_city_is_not_flagged(self):
        result = plan(TIMETABLE, ISM, AKROPOLIS, busy_weekday(), arrive_by=False)
        self.assertIs(result["cross_city"], False)
        self.assertEqual(result["from_city"], "Vilnius")

    def test_every_city_has_a_place_to_start(self):
        from vc.planner import city_summaries
        cities = city_summaries(TIMETABLE)
        self.assertEqual(len({c["name"] for c in cities}), len(cities))
        for city in cities:
            self.assertTrue(city["stop"])
            # The starting stop belongs to the city it is offered for.
            self.assertEqual(city_at_stop(city), city["name"])


def city_at_stop(city: dict) -> str:
    from vc.planner import city_at
    return city_at(TIMETABLE, city["lat"], city["lon"], within_m=5)
