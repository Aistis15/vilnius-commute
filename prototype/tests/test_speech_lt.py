"""The phrases from the original spec, and the ways they go wrong."""

import unittest

from vc.speech_lt import nominative_candidates, parse

TEN_AM = 10 * 60


class SpecPhrases(unittest.TestCase):

    def test_destination_and_time(self):
        r = parse("ISM keturiolika dvidešimt", TEN_AM)
        self.assertEqual(r.destination, "ISM")
        self.assertEqual(r.time, "14:20")
        self.assertEqual(r.mode, "arrive")

    def test_be_there_by_evening(self):
        r = parse("Noriu būti OZAS aštuntą vakaro", TEN_AM)
        self.assertEqual(r.destination, "OZAS")
        self.assertEqual(r.time, "20:00")
        self.assertEqual(r.mode, "arrive")

    def test_home_at_half_past(self):
        r = parse("Namo pusę trijų", TEN_AM)
        self.assertTrue(r.home)
        self.assertEqual(r.destination, "Namai")
        self.assertEqual(r.time, "14:30")

    def test_quarter_to_then_second_stop(self):
        r = parse("ISM be penkiolikos trys, po to OZAS", TEN_AM)
        self.assertEqual(r.destination, "ISM")
        self.assertEqual(r.time, "14:45")
        self.assertEqual(r.then, "OZAS")


class Vision(unittest.TestCase):

    def test_accusative_destination_with_time(self):
        r = parse("Man reikia į Akropolį keturiolika dvidešimt", TEN_AM)
        self.assertEqual(r.destination, "Akropolį")
        self.assertEqual(r.candidates[0], "Akropolis")
        self.assertEqual(r.time, "14:20")

    def test_destination_without_time_asks(self):
        r = parse("Man reikia į Akropolį", TEN_AM)
        self.assertEqual(r.candidates[0], "Akropolis")
        self.assertIsNone(r.time)
        self.assertIsNone(r.mode)
        self.assertFalse(r.now)

    def test_now(self):
        r = parse("Į Akropolį dabar", TEN_AM)
        self.assertTrue(r.now)
        self.assertIsNone(r.time)


class RecogniserOutput(unittest.TestCase):
    """Recognisers often write numbers as digits."""

    def test_clock_digits(self):
        self.assertEqual(parse("Į Akropolį 14:20", TEN_AM).time, "14:20")
        self.assertEqual(parse("Į Akropolį 14.20", TEN_AM).time, "14:20")

    def test_hour_and_minute_with_units(self):
        self.assertEqual(parse("ISM 14 val. 20 min.", TEN_AM).time, "14:20")

    def test_house_number_is_not_a_time(self):
        r = parse("Gedimino 9 keturiolika dvidešimt", TEN_AM)
        self.assertEqual(r.time, "14:20")
        self.assertEqual(r.destination, "Gedimino 9")

    def test_house_number_alone_is_not_a_time(self):
        r = parse("Gedimino 9", TEN_AM)
        self.assertIsNone(r.time)
        self.assertEqual(r.destination, "Gedimino 9")

    def test_missing_diacritics(self):
        r = parse("Noriu buti OZAS astunta vakaro", TEN_AM)
        self.assertEqual(r.time, "20:00")


class Clock(unittest.TestCase):

    def test_morning(self):
        self.assertEqual(parse("ISM devintą ryto", TEN_AM).time, "09:00")

    def test_next_occurrence_without_part_of_day(self):
        # At 10:00, "pusę dešimt" (9:30) has passed: it means 21:30.
        self.assertEqual(parse("Namo pusę dešimt", TEN_AM).time, "21:30")
        # At 08:00 it has not.
        self.assertEqual(parse("Namo pusę dešimt", 8 * 60).time, "09:30")

    def test_depart_mode(self):
        r = parse("Išvykti į ISM keturiolika", TEN_AM)
        self.assertEqual(r.mode, "depart")
        self.assertEqual(r.time, "14:00")


class Candidates(unittest.TestCase):

    def test_endings(self):
        self.assertIn("Akropolis", nominative_candidates("Akropolį"))
        self.assertIn("mokykla", nominative_candidates("mokyklą"))
        self.assertIn("universitetas", nominative_candidates("universitetą"))
        self.assertEqual(nominative_candidates("ISM"), ["ISM"])

    def test_adjective_and_noun_both_decline(self):
        self.assertEqual(nominative_candidates("Žaliąjį tiltą")[0], "Žaliasis tiltas")
        r = parse("Kaip nuvykti į Žaliąjį tiltą", TEN_AM)
        self.assertEqual(r.candidates[0], "Žaliasis tiltas")


if __name__ == "__main__":
    unittest.main()
