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


class SpelledLetters(unittest.TestCase):
    """Recognisers write an abbreviation said letter by letter as "i s m"."""

    def test_ism_spelled(self):
        r = parse("man reikia į i s m universitetą", TEN_AM)
        self.assertEqual(r.destination, "ISM universitetą")
        self.assertEqual(r.candidates[0], "ISM universitetas")

    def test_ism_spelled_without_the_preposition_hook(self):
        r = parse("man reikia i s m universitetą keturiolika dvidešimt", TEN_AM)
        self.assertEqual(r.candidates[0], "ISM universitetas")
        self.assertEqual(r.time, "14:20")

    def test_other_abbreviations(self):
        self.assertEqual(parse("Man reikia į k t u", TEN_AM).destination, "KTU")
        self.assertEqual(parse("Į v u dabar", TEN_AM).destination, "VU")

    def test_plain_i_before_letters_is_read_both_ways(self):
        # "i v u" is IVU or "į VU" with the hook lost: both get searched.
        self.assertEqual(parse("i v u", TEN_AM).candidates, ["IVU", "VU"])
        # From four letters the "i" is more likely the preposition.
        self.assertEqual(parse("man reikia i k t u", TEN_AM).candidates, ["KTU", "IKTU"])

    def test_preposition_is_not_a_letter(self):
        r = parse("Man reikia į Akropolį", TEN_AM)
        self.assertEqual(r.candidates[0], "Akropolis")
        self.assertEqual(parse("Man reikia i Akropolį", TEN_AM).candidates[0], "Akropolis")

    def test_written_initials_stay_apart(self):
        self.assertEqual(parse("M. K. Čiurlionio 5", TEN_AM).destination, "M K Čiurlionio 5")
        self.assertEqual(parse("Ozo g. 25", TEN_AM).destination, "Ozo g 25")



class SaidLikePeople(unittest.TestCase):
    """People say where they need to be, not what the map calls it."""

    def test_locative_with_a_genitive_before_it(self):
        r = parse("aš noriu būti Versmės progimnazijoje keturiolika dvidešimt", TEN_AM)
        self.assertEqual(r.candidates[0], "Versmės progimnazija")
        self.assertEqual((r.time, r.mode), ("14:20", "arrive"))

    def test_hesitation_keeps_the_settled_name(self):
        r = parse("tenai man reikia būti universitete, kokiam nors, tarkim, ISM universitete", TEN_AM)
        self.assertEqual(r.candidates[0], "ISM universitetas")

    def test_said_twice_keeps_the_fuller(self):
        self.assertEqual(parse("reikia būti universitete ISM universitete", TEN_AM).candidates[0], "ISM universitetas")

    def test_locative_forms(self):
        for said, name in (("Akropolyje", "Akropolis"), ("Fabijoniškėse", "Fabijoniškės"),
                           ("Pašilaičiuose", "Pašilaičiai"), ("Kalvarijų turguje", "Kalvarijų turgus"),
                           ("Žaliajame tilte", "Žaliasis tiltas"), ("Didžiojoje gatvėje", "Didžioji gatvė"),
                           ("Katedros aikštėje", "Katedros aikštė"), ("senamiestyje", "senamiestis"),
                           ("Naujojoje Vilnioje", "Naujoji Vilnia")):
            with self.subTest(said=said):
                self.assertIn(name, nominative_candidates(said))
                self.assertEqual(parse(f"noriu būti {said}", TEN_AM).candidates[0], name)

    def test_genitive_forms(self):
        for said, name in (("iki Akropolio", "Akropolis"), ("prie Katedros aikštės", "Katedros aikštė"),
                           ("iki senamiesčio", "senamiestis"), ("prie stoties", "stotis"),
                           ("netoli Kalvarijų turgaus", "Kalvarijų turgus")):
            with self.subTest(said=said):
                self.assertEqual(parse(said, TEN_AM).candidates[0], name)

    def test_a_name_with_ir_stays_whole(self):
        r = parse("noriu būti Operos ir baleto teatre", TEN_AM)
        self.assertEqual(r.candidates[0], "Operos ir baleto teatras")

    def test_i_am_is_not_a_place(self):
        self.assertEqual(parse("aš būsiu Akropolyje", TEN_AM).candidates[0], "Akropolis")


if __name__ == "__main__":
    unittest.main()


class HourSaidAlone(unittest.TestCase):
    """The hour on its own, the way people say it: "devynios", "iki
    devynių", "devintai valandai". A number in a place's name stays."""

    def check(self, text, time):
        r = parse(text, 8 * 60 + 10)
        self.assertEqual((r.destination, r.time, r.mode), ("Akropolį", time, "arrive"), text)

    def test_nominative_last(self):
        self.check("Man reikia į Akropolį devynios", "09:00")
        self.check("Man reikia į Akropolį devynios valandos", "09:00")

    def test_by_genitive(self):
        self.check("Man reikia į Akropolį iki devynių", "09:00")

    def test_dative_ordinal(self):
        self.check("Man reikia į Akropolį devintai valandai", "09:00")
        self.check("Man reikia į Akropolį devintai", "09:00")

    def test_zero_minutes_said_digit_by_digit(self):
        self.check("Man reikia į Akropolį devynios nulis nulis", "09:00")
        self.check("Man reikia į Akropolį devynios nulis penki", "09:05")

    def test_number_inside_a_name_is_not_a_time(self):
        r = parse("Man reikia į Trys kryžiai", 8 * 60 + 10)
        self.assertEqual(r.destination, "Trys kryžiai")
        self.assertIsNone(r.time)
