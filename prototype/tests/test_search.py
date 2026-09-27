"""Place search on real, recorded data: honest about what it does not know.

The Photon responses in fixtures/ were fetched once from photon.komoot.io
(see each file's "url" and "fetched"), and the stops are a sample of the real
Vilnius timetable, so these run offline and pin behaviour on real names.
"""

import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from vc import search
from vc.speech_lt import parse

FIXTURES = Path(__file__).resolve().parent / "fixtures"
PHOTON = {}
for path in FIXTURES.glob("photon_*.json"):
    recorded = json.loads(path.read_text("utf-8"))
    PHOTON[recorded["query"]] = recorded["response"]

SAMPLE = json.loads((FIXTURES / "stops_vilnius_sample.json").read_text("utf-8"))["stops"]

# A point in Kaunas, taken from the recorded KTU response (KTU Ekonomikos ir
# verslo fakultetas, Gedimino g. 50).
KAUNAS = (54.899091, 23.9218792)


def places(query):
    return search.photon_candidates(PHOTON[query])


def vilnius_index(extra=()):
    """The sampled Vilnius stops, plus any (name, city, lat, lon) given."""
    stops = [(s["name"], "Vilnius", s["lat"], s["lon"]) for s in SAMPLE] + list(extra)
    t = SimpleNamespace(
        stop_names=[s[0] for s in stops],
        stop_city=[s[1] for s in stops],
        stop_lat=[s[2] for s in stops],
        stop_lon=[s[3] for s in stops],
    )
    return search.StopIndex(t)


def ranked(query, origin=search.VILNIUS, index=None):
    index = index or vilnius_index()
    return search.rank(query, index.search(query, origin=origin) + places(query), origin)


def ranked_as(query, recorded, origin=search.VILNIUS):
    """A query ranked over the places recorded for another one: ranking is
    pure, so what Photon found for "Akropolis" can answer "Omniva"."""
    return search.rank(query, vilnius_index().search(query, origin=origin) + places(recorded), origin)


class Recorded(unittest.TestCase):

    def test_ism_universitetas_is_ism(self):
        top = ranked("ISM universitetas")[0]
        self.assertEqual(top["name"], "ISM Vadybos ir ekonomikos universitetas")
        self.assertEqual((top["match"], top["confidence"]), ("full", "high"))

    def test_generic_word_alone_is_never_sure(self):
        results = ranked("universitetas")
        self.assertTrue(results)
        self.assertFalse([r["name"] for r in results if r["confidence"] == "high"])
        self.assertTrue(search.is_ambiguous(results))

    def test_spelled_leftovers_never_claim_a_university(self):
        # What the recogniser left of "i s m universitetą" before letters were
        # joined: only the generic word matches, so nothing may look certain.
        results = ranked("s m universitetas")
        self.assertTrue(results)
        self.assertEqual({r["confidence"] for r in results}, {"low"})
        self.assertTrue(search.is_ambiguous(results))

    def test_a_missing_distinctive_word_always_ranks_lower(self):
        for query in PHOTON:
            with self.subTest(query=query):
                results = ranked(query)
                order = [(search.assess(query, r)["named"] > 0, search.assess(query, r)["covered"]) for r in results]
                self.assertEqual(order, sorted(order, reverse=True))

    def test_a_name_without_the_query_ranks_below_every_name_with_it(self):
        # The pharmacy in Akropolis, recorded at "Ozo g. 25", matches two of
        # the three words by its address. Every Akropolis, even the one in
        # Kaunas that matches only one, still comes first.
        results = ranked_as("Akropolis Ozo 25", "Akropolis")
        names = [r["name"] for r in results]
        pharmacy = names.index("Eurovaistinė")
        self.assertEqual(search.assess("Akropolis Ozo 25", results[pharmacy])["covered"], 2)
        kaunas = next(i for i, r in enumerate(results) if r["name"] == "Akropolis" and r["city"] == "Kaunas")
        self.assertLess(kaunas, pharmacy)
        self.assertTrue(all("Akropolis" in n for n in names[:pharmacy]))

    def test_parcel_lockers_are_not_places(self):
        # Recorded: "Omniva PC AKROPOLIS" in Kaunas and "PC Akropolis Venipak
        # paštomatas" in Šiauliai are parcel lockers named after the malls.
        lockers = {"Omniva PC AKROPOLIS", "PC Akropolis Venipak paštomatas"}
        for query in ("Akropolis", "Kauno Akropolis"):
            with self.subTest(query=query):
                self.assertTrue(lockers & {p["name"] for p in places(query)})
                names = [r["name"] for r in ranked(query)]
                self.assertFalse(lockers & set(names))
                self.assertEqual(names[0], "Akropolis")
        self.assertEqual([r["name"] for r in ranked("Kauno Akropolis")], ["Akropolis"])

    def test_a_parcel_locker_is_the_last_resort(self):
        # Asked for by what only the locker's name has, it is the answer.
        for query in ("Omniva", "Omniva Akropolis", "Venipak paštomatas"):
            with self.subTest(query=query):
                top = ranked_as(query, "Akropolis")[0]
                self.assertIn(top["name"], {"Omniva PC AKROPOLIS", "PC Akropolis Venipak paštomatas"})

    def test_information_boards_give_way_to_places(self):
        # Recorded: two OSM information boards about the Nemirseta rescue
        # station near Palanga, found for "Klaipėdos stotis".
        where = lambda r: (r["name"], r["lat"], r["lon"])  # noqa: E731
        boards = {where(p) for p in places("Klaipėdos stotis") if p["category"] == "board"}
        self.assertEqual(len(boards), 2)
        self.assertFalse(boards & {where(r) for r in ranked("Klaipėdos stotis")})

    def test_ism_alone_is_not_ismonys(self):
        results = ranked("ISM")
        self.assertEqual(results[0]["name"], "ISM Vadybos ir ekonomikos universitetas")
        self.assertEqual(results[0]["confidence"], "high")
        others = {r["name"]: r["match"] for r in results[1:]}
        self.assertEqual(others.get("Ismonys"), "none")
        self.assertEqual(others.get("Vismaliukai"), "none")

    def test_vilniaus_universitetas_beats_other_universities_in_vilnius(self):
        results = ranked("Vilniaus universitetas")
        self.assertEqual(results[0]["name"], "Vilniaus universitetas")
        self.assertEqual(results[0]["confidence"], "high")
        romeris = [r for r in results if r["name"] == "Mykolo Romerio universitetas"]
        self.assertTrue(romeris)
        self.assertTrue(all(r["match"] == "partial" for r in romeris))
        first_partial = next(i for i, r in enumerate(results) if r["match"] != "full")
        self.assertTrue(all(r["match"] != "full" for r in results[first_partial:]))

    def test_akropolis_is_the_mall_near_you(self):
        top = ranked("Akropolis")[0]
        self.assertEqual((top["name"], top["city"]), ("Akropolis", "Vilnius"))
        self.assertIn("Prekybos centras", top["subtitle"])
        top = ranked("Akropolis", origin=KAUNAS)[0]
        self.assertEqual((top["name"], top["city"]), ("Akropolis", "Kaunas"))

    def test_city_in_the_query_wins_over_distance(self):
        top = ranked("Kauno Akropolis")[0]
        self.assertEqual((top["name"], top["city"], top["match"]), ("Akropolis", "Kaunas", "full"))

    def test_ozas(self):
        top = ranked("OZAS")[0]
        self.assertEqual((top["name"], top["confidence"]), ("Ozas", "high"))

    def test_ktu_results_all_carry_ktu(self):
        results = ranked("KTU")
        self.assertTrue(results[0]["name"].startswith("KTU"))
        self.assertTrue(all("KTU" in r["name"] for r in results if r["match"] == "full"))

    def test_klaipedos_stotis_is_a_station_people_travel_to(self):
        results = ranked("Klaipėdos stotis")
        self.assertIn(results[0]["name"], {"Klaipėdos autobusų stotis", "Klaipėdos geležinkelio stotis"})
        self.assertFalse(search.is_ambiguous(results))


class Matching(unittest.TestCase):

    def place(self, name, city="Vilnius", **extra):
        return {"kind": "place", "name": name, "subtitle": "", "lat": 0.0, "lon": 0.0, "city": city, **extra}

    def test_abbreviation_matches_initials(self):
        self.assertEqual(search.assess("VU", self.place("Vilniaus universitetas"))["match"], "full")
        self.assertEqual(search.assess("VGTU", self.place("Vilniaus Gedimino technikos universitetas"))["match"], "full")

    def test_case_endings(self):
        self.assertEqual(search.assess("Akropolį", self.place("Akropolis"))["match"], "full")
        self.assertEqual(search.assess("ISM universitetą", self.place("ISM Vadybos ir ekonomikos universitetas"))["match"], "full")

    def test_generic_words_do_not_tell_places_apart(self):
        a = search.assess("ISM universitetas", self.place("Vilniaus universitetas"))
        self.assertEqual((a["match"], a["confidence"]), ("none", "low"))

    def test_typing_in_progress_is_only_partial(self):
        self.assertEqual(search.assess("akrop", self.place("Akropolis"))["match"], "partial")
        self.assertEqual(search.assess("ISM", self.place("Ismonys"))["match"], "none")

    def test_city_counts_but_only_the_name_makes_it_full(self):
        self.assertEqual(search.assess("Kauno Akropolis", self.place("Akropolis", "Kaunas"))["match"], "full")
        self.assertEqual(search.assess("Vilniaus universitetas", self.place("Mykolo Romerio universitetas"))["match"], "partial")

    def test_query_terms(self):
        self.assertEqual(search.query_terms("k t u"), (["ktu"], []))
        self.assertEqual(search.query_terms("į Akropolį"), (["akropoli"], []))
        # "pr." is read as the word it stands for.
        self.assertEqual(search.query_terms("Gedimino pr. 9"), (["gedimino", "9"], ["prospektas"]))

    def test_street_words_and_their_abbreviations_are_one(self):
        for query, name in (("Katedros aikštė", "Katedros a."), ("Katedros a.", "Katedros aikštė"),
                            ("Katedros aikštę", "Katedros a."), ("Gedimino prospektas 9", "Gedimino pr. 9"),
                            ("Laisvės al.", "Laisvės alėja"), ("Vynvyčių skersgatvis", "Vynvyčių skg."),
                            ("Tilžės gatvė", "Tilžės g.")):
            with self.subTest(query=query, name=name):
                a = search.assess(query, self.place(name))
                self.assertEqual((a["match"], a["confidence"], a["exact"], a["generic"]), ("full", "high", True, 1))

    def test_an_initial_is_not_a_square(self):
        self.assertEqual(search._words("A. Smetonos al."), ["a", "smetonos", "aleja"])
        self.assertEqual(search._words("Tilžės g. A"), ["tilzes", "gatve", "a"])
        self.assertEqual(search.query_terms("k a u"), (["kau"], []))

    def test_street_variants(self):
        cases = {
            "Katedros aikštė": ["Katedros a."],
            "Katedros aikštę": ["Katedros a."],
            "Europos a.": ["Europos aikštė"],
            "Gedimino pr. 9": ["Gedimino prospektas 9"],
            "Gedimino prospektas 9": ["Gedimino pr. 9"],
            "Laisvės al.": ["Laisvės alėja"],
            "Vynvyčių skg.": ["Vynvyčių skersgatvis"],
            "Akropolis": [],
            "Aikštė": [],
            "A. Smetonos": [],
        }
        for query, expected in cases.items():
            with self.subTest(query=query):
                self.assertEqual(search.street_variants(query), expected)

    def test_ambiguity(self):
        def r(match, score):
            return {"match": match, "score": score}
        self.assertTrue(search.is_ambiguous([r("partial", 0.6), r("partial", 0.55)]))
        self.assertFalse(search.is_ambiguous([r("full", 1.0), r("full", 1.0)]))
        self.assertFalse(search.is_ambiguous([r("partial", 0.9), r("none", 0.2)]))
        self.assertFalse(search.is_ambiguous([r("partial", 0.6)]))


class Stops(unittest.TestCase):

    # Synthetic: a stop called "Stotis" in Kaunas, to show two cities' stops of
    # the same name stay apart. Not a claim about the Kaunas timetable.
    KAUNAS_STOTIS = ("Stotis", "Kaunas", KAUNAS[0], KAUNAS[1])

    def test_grouped_by_name_and_city(self):
        index = vilnius_index([self.KAUNAS_STOTIS])
        found = index.search("Stotis")
        self.assertEqual([(s["name"], s["subtitle"]) for s in found],
                         [("Stotis", "Stotelė · Vilnius"), ("Stotis", "Stotelė · Kaunas")])
        near_kaunas = index.search("Stotis", origin=KAUNAS)
        self.assertEqual(near_kaunas[0]["subtitle"], "Stotelė · Kaunas")

    def test_city_word_in_the_query(self):
        found = vilnius_index([self.KAUNAS_STOTIS]).search("Kauno stotis")
        self.assertEqual([s["city"] for s in found], ["Kaunas"])

    def test_a_feed_stop_in_another_city_is_labelled_where_it_is(self):
        # Synthetic Šiauliai feed: two stops in Šiauliai (at PLC Akropolis
        # there, from the recorded response) and one ending at Vilnius Stotis.
        siauliai = (55.9076385, 23.2607916)
        vilnius_stotis = next((s["lat"], s["lon"]) for s in SAMPLE if s["name"] == "Stotis")
        index = vilnius_index([("Šiaulių stop A", "Šiauliai", *siauliai),
                               ("Šiaulių stop B", "Šiauliai", *siauliai),
                               ("Stotis", "Šiauliai", *vilnius_stotis)])
        self.assertEqual([s["subtitle"] for s in index.search("Stotis")], ["Stotelė · Vilnius"])
        self.assertEqual(index.search("Šiaulių stop A")[0]["subtitle"], "Stotelė · Šiauliai")

    def test_street_words_find_stops_either_way(self):
        # Real stops, names and places from the five-city timetable. No stop
        # there is called "Katedros aikštė"; Panevėžys has "Katedros g.".
        index = vilnius_index([("Europos aikštė", "Vilnius", 54.69564, 25.27743),
                               ("Vinco Kudirkos aikštė", "Vilnius", 54.68871, 25.27982),
                               ("Laisvės alėja A", "Kaunas", 54.89804, 23.89972),
                               ("Prisikėlimo aikštės st.", "Šiauliai", 55.93182, 23.31576),
                               ("Katedros g.", "Panevėžys", 55.72291, 24.36194)])
        for query, name in (("Europos a.", "Europos aikštė"), ("Europos aikštė", "Europos aikštė"),
                            ("Vinco Kudirkos aikštėje", "Vinco Kudirkos aikštė"),
                            ("Laisvės al.", "Laisvės alėja"), ("Laisvės alėja", "Laisvės alėja"),
                            ("Prisikėlimo a.", "Prisikėlimo aikštės st."),
                            ("Katedros gatvė", "Katedros g.")):
            with self.subTest(query=query):
                self.assertEqual(index.search(query)[0]["name"], name)
        self.assertEqual(index.search("Katedros aikštė"), [])

    def test_kaunas_platforms_are_one_stop(self):
        # Real Kaunas stops: every platform has a letter, and the two sides of
        # Laisvės alėja are one place to a person.
        kaunas = [("Laisvės alėja A", "Kaunas", 54.89804, 23.89972),
                  ("Laisvės alėja B", "Kaunas", 54.89864, 23.90229),
                  ("Geležinkelio stotis A", "Kaunas", 54.8874, 23.93028),
                  ("Geležinkelio stotis B", "Kaunas", 54.88798, 23.92892),
                  ("Geležinkelio stotis C", "Kaunas", 54.88786, 23.9331),
                  ("Geležinkelio stotis D", "Kaunas", 54.88729, 23.93227),
                  ("Geležinkelio stotis E", "Kaunas", 54.88752, 23.9337)]
        index = vilnius_index(kaunas)
        for query, name, platforms in (("Laisvės alėja", "Laisvės alėja", 2), ("Laisvės al.", "Laisvės alėja", 2),
                                       ("Geležinkelio stotis", "Geležinkelio stotis", 5)):
            with self.subTest(query=query):
                found = [s for s in index.search(query, origin=KAUNAS) if s["city"] == "Kaunas"]
                self.assertEqual([(s["name"], s["subtitle"]) for s in found], [(name, "Stotelė · Kaunas")])
                where = [s for s in kaunas if s[0].startswith(name)]
                self.assertEqual(len(where), platforms)
                self.assertAlmostEqual(found[0]["lat"], sum(s[2] for s in where) / platforms)
                self.assertAlmostEqual(found[0]["lon"], sum(s[3] for s in where) / platforms)

    def test_a_letter_is_a_platform_only_where_platforms_have_letters(self):
        # Synthetic: a Vilnius stop whose name ends in a capital letter. The
        # Vilnius feed does not letter its platforms, so the letter stays.
        index = vilnius_index([("Blokas C", "Vilnius", 54.70, 25.25)])
        self.assertEqual([s["name"] for s in index.search("Blokas")], ["Blokas C"])

    def test_same_name_far_apart_is_two_places(self):
        # Real Kaunas stops: "Vienybės g." D is 10 km from A and B, and the
        # "Malūnas" without a letter 12 km from C and D.
        index = vilnius_index([("Vienybės g. A", "Kaunas", 54.8332, 23.87587),
                               ("Vienybės g. B", "Kaunas", 54.83205, 23.87522),
                               ("Vienybės g. D", "Kaunas", 54.90264, 23.97395),
                               ("Malūnas", "Kaunas", 54.88821, 23.90488),
                               ("Malūnas C", "Kaunas", 54.86812, 24.08539),
                               ("Malūnas D", "Kaunas", 54.86756, 24.08619)])
        vienybes = sorted((round(s["lat"], 5), round(s["lon"], 5)) for s in index.search("Vienybės g.", origin=KAUNAS))
        self.assertEqual(vienybes, [(round((54.8332 + 54.83205) / 2, 5), round((23.87587 + 23.87522) / 2, 5)),
                                    (54.90264, 23.97395)])
        malunas = index.search("Malūnas", origin=KAUNAS)
        self.assertEqual(len(malunas), 2)
        self.assertEqual({s["name"] for s in malunas}, {"Malūnas"})

    def test_osm_may_name_a_platform_either_way(self):
        index = vilnius_index([("Laisvės alėja A", "Kaunas", 54.89804, 23.89972),
                               ("Laisvės alėja B", "Kaunas", 54.89864, 23.90229)])
        self.assertTrue(index.has_stop_near("Laisvės alėja", 54.89805, 23.89975))
        self.assertTrue(index.has_stop_near("Laisvės alėja B", 54.89865, 23.9023))
        self.assertFalse(index.has_stop_near("Laisvės alėja", 54.8874, 23.93028))

    def test_city_defaults_to_vilnius(self):
        t = SimpleNamespace(stop_names=["Žaliasis tiltas"], stop_lat=[54.6922], stop_lon=[25.2802])
        found = search.StopIndex(t).search("Žaliasis tiltas")
        self.assertEqual(found[0]["subtitle"], "Stotelė · Vilnius")


def fake_photon(query, origin):
    fake_photon.origins.append(origin)
    fake_photon.queries.append(query)
    if query not in PHOTON:
        raise OSError("offline in tests")
    return PHOTON[query]


fake_photon.origins, fake_photon.queries = [], []


class EndToEnd(unittest.TestCase):

    def setUp(self):
        search._cache.clear()
        fake_photon.origins, fake_photon.queries = [], []
        patcher = mock.patch.object(search, "_fetch_photon", fake_photon)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(search._cache.clear)
        self.index = vilnius_index()

    def test_spelled_ism_from_speech(self):
        for said in ("man reikia į i s m universitetą", "man reikia į ISM universitetą", "i s m universitetą"):
            with self.subTest(said=said):
                found = search.resolve(self.index, parse(said).candidates)
                top = found["results"][0]
                self.assertEqual(top["name"], "ISM Vadybos ir ekonomikos universitetas")
                self.assertEqual(top["confidence"], "high")
                self.assertFalse(found["ambiguous"])

    def test_katedros_aikste_is_found_as_osm_writes_it(self):
        # Photon finds nothing for "Katedros aikštė" (recorded); OSM has the
        # square as "Katedros a.".
        self.assertFalse(PHOTON["Katedros aikštė"]["features"])
        found = search.search(self.index, "Katedros aikštė")
        top = found["results"][0]
        self.assertEqual((top["name"], top["city"], top["match"], top["confidence"]),
                         ("Katedros a.", "Vilnius", "full", "high"))
        self.assertFalse(found["ambiguous"])
        self.assertEqual(fake_photon.queries, ["Katedros aikštė", "Katedros a."])

    def test_katedros_aikste_from_speech(self):
        found = search.resolve(self.index, parse("Man reikia į Katedros aikštę").candidates)
        self.assertEqual((found["results"][0]["name"], found["results"][0]["city"]), ("Katedros a.", "Vilnius"))
        self.assertEqual(found["results"][0]["confidence"], "high")

    def test_a_sure_answer_asks_photon_once(self):
        index = vilnius_index([("Europos aikštė", "Vilnius", 54.69564, 25.27743)])
        found = search.search(index, "Europos a.")
        self.assertEqual((found["results"][0]["name"], found["results"][0]["confidence"]), ("Europos aikštė", "high"))
        self.assertEqual(fake_photon.queries, ["Europos a."])

    def test_position_reaches_photon(self):
        search.search(self.index, "Akropolis")
        search.search(self.index, "Akropolis", *KAUNAS)
        self.assertEqual(fake_photon.origins, [search.VILNIUS, KAUNAS])

    def test_osm_copy_of_a_timetable_stop_is_dropped(self):
        results = search.search(self.index, "Vilniaus universitetas")["results"]
        near_stop = [r for r in results if r["name"] == "Vilniaus universitetas"
                     and search.distance_km(r["lat"], r["lon"], (54.7247, 25.3317)) < 0.3]
        self.assertEqual([r["kind"] for r in near_stop], ["stop"])

    def test_offline_still_finds_stops(self):
        found = search.search(self.index, "Žaliasis tiltas")
        self.assertEqual(found["results"][0]["name"], "Žaliasis tiltas")
        self.assertEqual(found["results"][0]["kind"], "stop")

    def test_results_keep_their_old_shape(self):
        for result in search.search(self.index, "Akropolis")["results"]:
            self.assertTrue({"kind", "name", "subtitle", "lat", "lon"} <= result.keys())
            self.assertIn(result["confidence"], {"high", "medium", "low"})


if __name__ == "__main__":
    unittest.main()
