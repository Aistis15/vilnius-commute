"""Finding a place from what someone typed or said.

Two sources, merged:
- the timetable's own stop names, instantly and offline;
- Photon, a free OpenStreetMap geocoder, for addresses and places anywhere in
  Lithuania. No key needed. Biased to where you are (Vilnius by default).

Ranking is about not lying. "ISM universitetas" must never become Vilniaus
universitetas because both are universities: only "ISM" tells them apart, so a
name without it ranks below every name with it, and every result says how
sure we are ("confidence") so the app can ask instead of guessing.
"""

from __future__ import annotations

import json
import math
import re
import threading
import urllib.parse
import urllib.request

from .data import USER_AGENT, Timetable
from .speech_lt import fold

VILNIUS = (54.6872, 25.2797)
PHOTON = "https://photon.komoot.io/api/?"
# Lithuania, as min lon, min lat, max lon, max lat. Without it "Akropolis"
# returns Athens and Šiauliai before the mall on Ozo g.
LITHUANIA_BBOX = "20.9,53.89,26.84,56.45"
# Within this of the origin counts as "here": a city and its suburbs, not the
# next city (Kaunas is about 90 km from Vilnius).
LOCAL_KM = 25

# What people travel to, versus what merely shares the name.
IMPORTANT = {
    "mall", "university", "college", "school", "kindergarten", "hospital", "clinic",
    "station", "stadium", "sports_centre", "cinema", "theatre", "marketplace",
    "museum", "attraction", "library", "townhall", "supermarket", "office",
    "arts_centre", "church", "cathedral", "park", "airport", "aerodrome",
    "bus_station", "train_station",
}
# Things, not places: a parcel locker in Akropolis is not where anyone is
# going. Shown only when nothing else matches as well ("Omniva Akropolis").
OBJECTS = {
    "parcel_locker", "atm", "vending_machine", "bench", "waste_basket", "bicycle_parking",
    "parking_space", "post_box", "telephone", "charging_station", "toilets", "board",
    "guidepost", "map", "recycling", "drinking_water", "defibrillator", "payment_terminal",
}
# The same things by name, when OSM files them under something else.
OBJECT_WORDS = {"pastomatas", "bankomatas", "paketomatas"}
INCIDENTAL = OBJECTS | {"construction", "parking", "isolated_dwelling", "industrial", "railway"}
# OSM's own copy of a stop: dropped when the timetable has the same stop.
TRANSIT_STOPS = {"bus_stop", "platform", "stop_position", "tram_stop", "stop"}
KINDS = {"mall": "Prekybos centras", "university": "Universitetas", "college": "Kolegija",
         "school": "Mokykla", "hospital": "Ligoninė", "station": "Stotis", "cinema": "Kinas",
         "stadium": "Stadionas", "museum": "Muziejus", "supermarket": "Parduotuvė"}

# Words that say what kind of place it is, not which one. Matched in any case
# ("universitetą", "stoties"), so only the base form is listed.
GENERIC = [fold(w) for w in """
    universitetas akademija kolegija mokykla gimnazija progimnazija licėjus darželis fakultetas
    gatvė g prospektas pr alėja al aikštė a plentas pl skersgatvis skg kelias tiltas
    prekybos centras plc pc tc ppc parduotuvė turgus parkas
    stotelė stotis ligoninė poliklinika klinika
    ir
""".split()]

# How well one query word is covered. A name word counts for more than the
# city or street the place is in.
EXACT, STEM, INITIALS, CONTEXT, PREFIX = 1.0, 0.9, 0.85, 0.6, 0.5
TIERS = {"full": 3, "partial": 2, "generic": 1, "none": 0}
CLOSE = 0.15     # scores this near are a coin toss

# Street words, every case of them, and how OpenStreetMap and the timetables
# shorten them. Photon knows "Katedros a." but finds nothing for "Katedros
# aikštė", so both spellings are tried, and matching counts them as one word.
STREET_WORDS = {
    "aikštė": ("a.", "aikštė aikštės aikštei aikštę aikšte aikštėje"),
    "gatvė": ("g.", "gatvė gatvės gatvei gatvę gatve gatvėje"),
    "prospektas": ("pr.", "prospektas prospekto prospektui prospektą prospektu prospekte"),
    "alėja": ("al.", "alėja alėjos alėjai alėją alėjoje"),
    "skersgatvis": ("skg.", "skersgatvis skersgatvio skersgatviui skersgatvį skersgatviu skersgatvyje"),
}
_SPELLED = {short.rstrip("."): word for word, (short, _) in STREET_WORDS.items()}
_SHORTENED = {fold(word): short for word, (short, _) in STREET_WORDS.items()}
# Folded word -> folded base form. Written-out abbreviations of two letters or
# more are unmistakable; "a." and "g." only with the full stop, below.
_STREET_WORD = {fold(form): fold(word) for word, (_, forms) in STREET_WORDS.items() for form in forms.split()}
_STREET_WORD.update({short: fold(word) for short, word in _SPELLED.items() if len(short) > 1})
# "Katedros a.", "Tilžės g. A": a lower-case abbreviation after a word. "A." at
# the start or in capitals is someone's initial (A. Smetonos al.).
_ABBREVIATED = re.compile(r"(?<=\w)(\s+)(a|g|pr|al|skg)\.(?!\w)")


def _words(text: str) -> list[str]:
    spelled = _ABBREVIATED.sub(lambda m: m.group(1) + _SPELLED[m.group(2)], text or "")
    return [_STREET_WORD.get(w, w) for w in re.findall(r"[^\W_]+", fold(spelled))]


def _plain(text: str) -> str:
    """A name as matching sees it: folded, street words spelled out, no
    punctuation. "Katedros a." and "Katedros aikštė" are the same."""
    return " ".join(_words(text))


def street_variants(query: str) -> list[str]:
    """The query with its street words shortened the way OpenStreetMap writes
    them ("Katedros aikštę" -> "Katedros a."), and spelled out ("Europos a."
    -> "Europos aikštė"). Empty when there is no street word after a name."""
    tokens = query.split()
    short, full = [], []
    for i, token in enumerate(tokens):
        bare = token.rstrip(".,;")
        tail = token[len(bare):]
        key = fold(bare)
        if i and key in _STREET_WORD and key not in _SPELLED:
            short.append(_SHORTENED[_STREET_WORD[key]] + tail.lstrip("."))
            full.append(token)
        elif i and key in _SPELLED and bare.islower() and (tail.startswith(".") or len(key) > 1):
            full.append(_SPELLED[key] + (tail[1:] if tail.startswith(".") else tail))
            short.append(token)
        else:
            short.append(token)
            full.append(token)
    original = " ".join(tokens)
    return [v for v in dict.fromkeys((" ".join(short), " ".join(full))) if v != original]


# Case endings as matching sees them (folded, no hooks), longest first:
# "progimnazijoje" and "progimnazija" are one word, and so are "Akropolyje"
# and "Akropolis".
_CASE_ENDINGS = sorted({fold(e) for e in (
    "uose ėse ose oje ėje yje uje džio čio ies aus io ių ų į ą ę es os ės o e "
    "as is ys us ius a ė ai iai ui ams oms".split())}, key=len, reverse=True)


def _stem(word: str) -> str:
    for ending in _CASE_ENDINGS:
        if word.endswith(ending) and len(word) - len(ending) >= 4:
            return word[: -len(ending)]
    return word


def _same_word(a: str, b: str) -> bool:
    """Equal, or the same word in another case: of two words of five letters
    or more, only the last two letters of the longer may differ (Akropolį and
    Akropolis, Kauno and Kaunas, universitetą and universitetas), or the two
    are one stem with case endings (progimnazijoje and progimnazija)."""
    if a == b:
        return True
    if len(a) < 5 or len(b) < 5:
        return False
    if _stem(a) == _stem(b) and len(_stem(a)) >= 4:
        return True
    common = 0
    for x, y in zip(a, b):
        if x != y:
            break
        common += 1
    return common >= max(len(a), len(b)) - 2


def is_generic(word: str) -> bool:
    return any(_same_word(word, g) for g in GENERIC)


def _genitive(word: str) -> str:
    """Vilnius -> Vilniaus, Kaunas -> Kauno, Klaipėda -> Klaipėdos, Šiauliai ->
    Šiaulių, Panevėžys -> Panevėžio: "Kauno Akropolis" names the city that way."""
    for ending, genitive in (("ius", "iaus"), ("iai", "iu"), ("ys", "io"), ("is", "io"),
                             ("as", "o"), ("us", "aus"), ("a", "os"), ("e", "es")):
        if word.endswith(ending):
            return word[: -len(ending)] + genitive
    return word


def query_terms(query: str) -> tuple[list[str], list[str]]:
    """(distinctive, generic) words of a query. Letters spelled one by one
    ("k t u") count as the abbreviation they spell; any other lone letter
    ("į", "g") says nothing about which place."""
    distinctive, generic, letters = [], [], []

    def flush():
        if len(letters) > 1:
            distinctive.append("".join(letters))
        letters.clear()

    for word in _words(query):
        if len(word) == 1 and word.isalpha():
            letters.append(word)
            continue
        flush()
        target = generic if is_generic(word) else distinctive
        if word not in target:
            target.append(word)
    flush()
    return distinctive, generic


def _word_quality(word: str, name_words: list[str], initials: str, last: bool, caps: bool) -> float:
    if word in name_words:
        return EXACT
    if any(_same_word(word, n) for n in name_words):
        return STEM
    # VU, KTU, VGTU: the first letters of consecutive words of the name.
    if 2 <= len(word) <= 5 and word.isalpha() and word in initials:
        return INITIALS
    # Still being typed ("akrop"). Never for a capitalised abbreviation: ISM
    # is not the start of Ismonys.
    if last and not caps and len(word) >= 3 and any(n.startswith(word) for n in name_words):
        return PREFIX
    return 0.0


def assess(query: str, candidate: dict) -> dict:
    """How well a candidate's name covers the query.

    Returns covered (distinctive words found in the name, city or street),
    named (those found in the name itself), quality (their summed quality),
    generic (generic words found), match and confidence. The city and street count ("Kauno Akropolis" is the Akropolis
    in Kaunas) but only the name can make a match "full".
    """
    distinctive, generic = query_terms(query)
    raw_words = re.findall(r"[^\W_]+", query or "")
    caps_words = {fold(w) for w in raw_words if len(w) > 1 and w.isupper()}
    name_words = _words(candidate["name"])
    initials = "".join(w[0] for w in name_words if w != "ir")
    context = []
    for word in _words(candidate.get("city", "")):
        context += [word, _genitive(word)]
    context += _words(candidate.get("street", ""))

    qualities = []
    for i, word in enumerate(distinctive):
        in_name = _word_quality(word, name_words, initials, i == len(distinctive) - 1, word in caps_words)
        in_context = CONTEXT if any(_same_word(word, c) for c in context) else 0.0
        qualities.append((in_name, in_context))

    named = sum(1 for n, _ in qualities if n > 0)
    generic_hits = sum(1 for g in generic if any(_same_word(g, n) for n in name_words))
    generic_share = generic_hits / len(generic) if generic else 0.0
    exact_name = _plain(candidate["name"]) == _plain(query)

    if distinctive:
        best = [max(pair) for pair in qualities]
        covered = sum(1 for q in best if q > 0)
        quality = sum(best)
        strong_in_name = sum(1 for n, _ in qualities if n >= INITIALS)
        complete = all(n >= INITIALS or c > 0 for n, c in qualities)
        if covered == len(distinctive) and complete and strong_in_name:
            match = "full"
        elif covered:
            match = "partial"
        else:
            match = "none"
        score = quality / len(distinctive)
        if generic:
            score = 0.85 * score + 0.15 * generic_share
    else:
        # Only generic words ("universitetas"): every university fits equally.
        covered, quality = 0, 0.0
        match = "generic" if generic_hits or exact_name else "none"
        score = 0.4 * generic_share + (0.1 if exact_name else 0.0)

    if match == "full":
        confidence = "high"
    elif match == "partial" or (match == "generic" and exact_name):
        confidence = "medium"
    else:
        confidence = "low"

    distinct_name = [w for w in name_words if len(w) > 1 and not is_generic(w)]
    matched = sum(1 for n in distinct_name if any(_same_word(n, d) or n.startswith(d) for d in distinctive))
    precision = matched / len(distinct_name) if distinct_name else 0.0
    return {"covered": covered, "named": named, "quality": round(quality, 3), "generic": generic_hits,
            "match": match, "confidence": confidence, "score": round(score, 3),
            "precision": precision, "exact": exact_name}


def rank(query: str, candidates: list[dict], origin: tuple[float, float] = VILNIUS) -> list[dict]:
    """Order stops and places for a query. Pure: no network, no timetable.

    Each candidate has kind, name, subtitle, lat, lon, and optionally city,
    street, category (the OSM value) and, for stops, strength (0 exact name,
    1 name starts with the query, 2 a word does, 3 the letters are merely
    inside). Returns the public results, best first, each with a score (0..1,
    higher is better), match ("full", "partial", "generic", "none") and
    confidence ("high", "medium", "low").
    """
    looks_like_address = any(ch.isdigit() for ch in query)
    strong_seen = 0
    keyed = []
    for index, item in enumerate(candidates):
        a = assess(query, item)
        distance = distance_km(item["lat"], item["lon"], origin)
        # The order the merge used before ranking by match: a stop that
        # matches from the start of a word beats a place of equal match, one
        # that only contains the letters ("ism" in "Vismaliukai") does not.
        if item["kind"] == "stop":
            strong = item.get("strength", 3) <= 2
            if looks_like_address:
                group = 1 if strong else 2
            elif strong:
                group = 0 if strong_seen < 3 else 2
                strong_seen += 1
            else:
                group = 3
            local_score = 0.0
        else:
            group = 0 if looks_like_address else 1
            local_score = _place_score(item, a, distance)
        # A name without a single distinctive word of the query is something
        # else that happens to be there: the pharmacy in Akropolis, at Ozo g.
        # 25, or anything in Kaunas for "Kauno ...". It goes below every
        # result whose name has one, however well its address matches.
        key = (not a["named"], -a["covered"], -a["quality"], -a["generic"], distance > LOCAL_KM,
               group, local_score, index)
        keyed.append((key, item, a))
    keyed.sort(key=lambda entry: entry[0])

    # A parcel locker or a cash machine named after the place is not the
    # place: while a real place matches as well, the object is left out.
    real = [(bool(a["named"]), a["covered"]) for _, item, a in keyed
            if a["match"] != "none" and not is_object(item)]
    best_real = max(real, default=None)
    keyed = [entry for entry in keyed
             if not is_object(entry[1]) or best_real is None
             or (bool(entry[2]["named"]), entry[2]["covered"]) > best_real]

    out = []
    for _, item, a in keyed:
        result = {k: v for k, v in item.items() if k not in ("strength", "category")}
        result.update(score=a["score"], match=a["match"], confidence=a["confidence"])
        out.append(result)
    return out


def is_object(item: dict) -> bool:
    """A thing in a place rather than a place: a parcel locker, a cash machine."""
    if item.get("kind") == "stop":
        return False
    return item.get("category") in OBJECTS or not OBJECT_WORDS.isdisjoint(_words(item["name"]))


def _place_score(item: dict, a: dict, distance: float) -> float:
    """Among places that match equally well and are as near, lower is better."""
    score = 0.0
    kind = item.get("category", "")
    if kind in IMPORTANT:
        score -= 2
    if kind in INCIDENTAL:
        score += 3
    if a["exact"]:
        score -= 1
    # "Akropolis" is the mall; "Apollo Kinas Akropolis" is something in it.
    # Worth as much as being a mall: "Žaliasis tiltas" is the bridge, not the
    # IKI Express named after it.
    score -= 2 * a["precision"]
    return score + distance / 50


def is_ambiguous(results: list[dict]) -> bool:
    """The two best are about as good and neither is what was asked for."""
    if len(results) < 2:
        return False
    first, second = results[0], results[1]
    if "full" in (first["match"], second["match"]):
        return False
    return abs(first["score"] - second["score"]) <= CLOSE


def _where_stops_are(cities: list[str], lats: list[float], lons: list[float]) -> list[str]:
    """The city a stop is in, not just the feed it came from.

    A city's feed also has its intercity stops (Šiauliai's buses end at Vilnius
    AS), and "Stotelė · Šiauliai" on a Vilnius stop would be a lie. Most of a
    feed's stops lie in its city, so the feed's median point stands for the
    city; a stop far from its own feed's city but near another's belongs there.
    """
    centres = {}
    for city in set(cities):
        points = [(lats[i], lons[i]) for i, c in enumerate(cities) if c == city]
        centres[city] = (sorted(p[0] for p in points)[len(points) // 2],
                         sorted(p[1] for p in points)[len(points) // 2])
    if len(centres) < 2:
        return cities
    out = []
    for city, lat, lon in zip(cities, lats, lons):
        if distance_km(lat, lon, centres[city]) > LOCAL_KM:
            nearest = min(centres, key=lambda c: distance_km(lat, lon, centres[c]))
            if distance_km(lat, lon, centres[nearest]) <= LOCAL_KM:
                city = nearest
        out.append(city)
    return out


# Kaunas letters every platform of a stop: "Laisvės alėja A" and "Laisvės
# alėja B" are the two sides of one street. A capital letter at the end is a
# platform only in a feed where most names end in one (Kaunas: 837 of 966);
# elsewhere it may be part of the name, and stays.
_PLATFORM = re.compile(r"^(.*\S)\s+[A-Z]$")
# Platforms of one stop stand within a few hundred metres of one another. Two
# stops of one name farther apart are two places: Kaunas has a "Vienybės g. D"
# 10 km from A and B, Vilnius two "Slėnis" 16 km apart.
SAME_STOP_KM = 0.6


def _lettered_feeds(names: list[str], feeds: list[str]) -> set[str]:
    """The feeds that name their platforms with a letter."""
    total: dict[str, int] = {}
    lettered: dict[str, int] = {}
    for name, feed in zip(names, feeds):
        total[feed] = total.get(feed, 0) + 1
        if _PLATFORM.match(name):
            lettered[feed] = lettered.get(feed, 0) + 1
    return {feed for feed, count in lettered.items() if 2 * count > total[feed]}


def _nearby_groups(ids: list[int], lats: list[float], lons: list[float]) -> list[list[int]]:
    """Stops chained within SAME_STOP_KM of one another: one place each."""
    groups: list[list[int]] = []
    for stop in ids:
        near = [g for g in groups
                if any(distance_km(lats[stop], lons[stop], (lats[o], lons[o])) <= SAME_STOP_KM for o in g)]
        groups = [g for g in groups if all(g is not n for n in near)]
        groups.append([o for g in near for o in g] + [stop])
    return sorted(groups, key=min)


class StopIndex:
    """Stops grouped by name and city: "Žaliasis tiltas" is one place to a
    person, even though the timetable has a stop for each direction, and so
    is "Laisvės alėja" in Kaunas with its platforms A and B. A "Stotis" in
    Kaunas is not the one in Vilnius, and two stops of one name far apart in
    one city are two places."""

    def __init__(self, t: Timetable):
        feeds = getattr(t, "stop_city", None)
        if not feeds or len(feeds) != len(t.stop_names):
            feeds = ["Vilnius"] * len(t.stop_names)
        feeds = [c or "Vilnius" for c in feeds]
        cities = _where_stops_are(feeds, t.stop_lat, t.stop_lon)
        lettered = _lettered_feeds(t.stop_names, feeds)
        groups: dict[tuple[str, str], list[int]] = {}
        for stop, name in enumerate(t.stop_names):
            if feeds[stop] in lettered:
                name = _PLATFORM.sub(r"\1", name)
            groups.setdefault((name, cities[stop]), []).append(stop)
        self.entries = []
        # Every stop under its own name and its place's: OSM may call the
        # platform either way.
        self.by_name: dict[str, list[tuple[float, float]]] = {}
        for (name, city), ids in groups.items():
            context = [w for word in _words(city) for w in (word, _genitive(word))]
            for group in _nearby_groups(ids, t.stop_lat, t.stop_lon):
                lat = sum(t.stop_lat[i] for i in group) / len(group)
                lon = sum(t.stop_lon[i] for i in group) / len(group)
                self.entries.append((_plain(name), name, city, lat, lon, context))
            for stop in ids:
                for label in {_plain(name), _plain(t.stop_names[stop])}:
                    self.by_name.setdefault(label, []).append((t.stop_lat[stop], t.stop_lon[stop]))

    def covers(self, lat: float, lon: float, km: float = 3.0) -> bool:
        """Whether a place is within the networks the app plans in: some stop
        no more than `km` away. Photon searches all of Lithuania; a place in
        Šiauliai is a result the app could only fail on."""
        return any(abs(slat - lat) < 0.03 and abs(slon - lon) < 0.05
                   and distance_km(lat, lon, (slat, slon)) <= km
                   for _, _, _, slat, slon, _ in self.entries)

    def has_stop_near(self, name: str, lat: float, lon: float, km: float = 0.3) -> bool:
        return any(distance_km(lat, lon, where) <= km for where in self.by_name.get(_plain(name), []))

    def search(self, query: str, limit: int = 5, origin: tuple[float, float] = VILNIUS) -> list[dict]:
        """Stops whose name matches, each tagged with how strongly."""
        q = _plain(query)
        if len(q) < 2:
            return []
        words = q.split()
        scored = []
        for folded, name, city, lat, lon, context in self.entries:
            in_name = [w for w in words if w in folded]
            # "Kauno Akropolis": a word may name the stop's city instead.
            rest = [w for w in words if w not in folded]
            if not in_name or not all(any(_same_word(w, c) for c in context) for w in rest):
                continue
            named = " ".join(in_name)
            if folded == named:
                strength = 0
            elif folded.startswith(named):
                strength = 1
            elif any(part.startswith(in_name[0]) for part in folded.split()):
                strength = 2
            else:
                strength = 3
            distance = distance_km(lat, lon, origin)
            scored.append((strength, distance > LOCAL_KM, len(folded), distance, name, city, lat, lon))
        scored.sort()
        return [
            {"kind": "stop", "name": name, "subtitle": f"Stotelė · {city}", "lat": lat, "lon": lon,
             "city": city, "strength": strength}
            for strength, _, _, _, name, city, lat, lon in scored[:limit]
        ]


_cache: dict[tuple, list[dict]] = {}
_lock = threading.Lock()


def _fetch_photon(query: str, origin: tuple[float, float]) -> dict:
    url = PHOTON + urllib.parse.urlencode(
        {"q": query, "lat": origin[0], "lon": origin[1], "limit": 15, "bbox": LITHUANIA_BBOX}
    )
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=6) as response:
        return json.loads(response.read())


def photon_candidates(data: dict) -> list[dict]:
    """Photon's GeoJSON as rank() candidates, in Photon's order."""
    found, seen = [], set()
    for feature in data.get("features", []):
        p = feature.get("properties", {})
        if p.get("countrycode") not in (None, "LT"):
            continue
        lon, lat = feature["geometry"]["coordinates"]
        street = " ".join(x for x in (p.get("street"), p.get("housenumber")) if x)
        name = p.get("name") or street
        if not name:
            continue
        # PLC „Akropolis“ is called Akropolis by everyone who goes there.
        branded = re.match(r"^(?:PLC|PC|TC|PPC)\s+[„\"](.+?)[“\"]$", name)
        if branded:
            name = branded.group(1)
        kind = p.get("osm_value", "")
        where = p.get("city") or p.get("county") or p.get("state") or ""
        label = KINDS.get(kind, "")
        subtitle = ", ".join(x for x in (label, street if street != name else "", where) if x)
        identity = (fold(name), round(lat, 3), round(lon, 3))
        if identity in seen:
            continue
        seen.add(identity)
        # Only a real city names the place: "Vilniaus apskritis" must not make
        # every village around Vilnius match "Vilniaus universitetas".
        found.append({"kind": "place", "name": name, "subtitle": subtitle, "lat": lat, "lon": lon,
                      "city": p.get("city") or "", "street": street, "category": kind})
    return found


def places(query: str, origin: tuple[float, float] = VILNIUS) -> list[dict]:
    """Photon candidates for a query, unranked. Empty when offline."""
    key = (fold(query).strip(), round(origin[0], 2), round(origin[1], 2))
    if len(key[0]) < 2:
        return []
    with _lock:
        if key in _cache:
            return _cache[key]
    try:
        found = photon_candidates(_fetch_photon(query, origin))
    except Exception:  # noqa: BLE001 - offline or throttled: stops still work
        return []
    with _lock:
        _cache[key] = found
    return found


def distance_km(lat: float, lon: float, origin: tuple[float, float] = VILNIUS) -> float:
    dlat = (lat - origin[0]) * 111.2
    dlon = (lon - origin[1]) * 111.2 * math.cos(math.radians(origin[0]))
    return math.hypot(dlat, dlon)


def search(index: StopIndex, query: str, lat: float | None = None, lon: float | None = None) -> dict:
    """{"results": [...], "ambiguous": bool}, biased to (lat, lon), or to the
    centre of Vilnius when no position is known."""
    origin = (lat, lon) if lat is not None and lon is not None else VILNIUS

    def found(text: str) -> list[dict]:
        return [p for p in places(text, origin)
                if index.covers(p["lat"], p["lon"])
                and not (p["category"] in TRANSIT_STOPS and index.has_stop_near(p["name"], p["lat"], p["lon"]))]

    candidates = index.search(query, origin=origin) + found(query)
    out = _best(rank(query, candidates, origin))
    # Nothing sure: ask Photon again with the street word spelled the other
    # way ("Katedros aikštė" -> "Katedros a."). Ranked by what was asked.
    for variant in street_variants(query):
        if out and out[0]["confidence"] == "high" and not is_ambiguous(out):
            break
        more = found(variant)
        if more:
            candidates += more
            out = _best(rank(query, candidates, origin))
    # Typed the way it is said ("ISM universitete", "Akropolyje"): ask again
    # with the name's own form, and keep that answer when it is surer.
    if not (out and out[0]["confidence"] == "high"):
        from .speech_lt import nominative_candidates
        for form in nominative_candidates(query)[:3]:
            if fold(form) == fold(query):
                continue
            more = index.search(form, origin=origin) + found(form)
            if not more:
                continue
            ranked = _best(rank(form, candidates + more, origin))
            if ranked and ranked[0]["confidence"] == "high":
                out = ranked
                break
    return {"results": out, "ambiguous": is_ambiguous(out)}


def _best(ranked: list[dict]) -> list[dict]:
    """The first ten, each place once."""
    seen, out = set(), []
    for item in ranked:
        identity = (fold(item["name"]), round(item["lat"], 3), round(item["lon"], 3))
        if identity not in seen:
            seen.add(identity)
            out.append(item)
    return out[:10]


def resolve(index: StopIndex, candidates: list[str], lat: float | None = None,
            lon: float | None = None) -> dict:
    """The best reading of a spoken destination. Speech gives several spellings
    ("ISM universitetas", "i SM universitetas"); each is searched in turn,
    stopping at the first whose best result is a clear, full match on every
    word. "Katedra aikštė" finds a cathedral but not the square, so
    "Katedros aikštė", read next, gets its turn."""
    best, best_key = None, None
    for query in candidates[:6]:
        found = search(index, query, lat, lon)
        found["query"] = query
        top = found["results"][0] if found["results"] else None
        if top and top["match"] == "full" and top["score"] >= 0.999 and not found["ambiguous"]:
            return found
        key = (TIERS[top["match"]], top["score"]) if top else (-1, 0.0)
        if best_key is None or key > best_key:
            best, best_key = found, key
    return best or {"results": [], "ambiguous": False, "query": None}


_reverse_cache: dict[tuple, str | None] = {}


def reverse(lat: float, lon: float) -> str | None:
    """What a point on the map is called: the place or address Photon knows
    there ("Gedimino pr. 9"), for a pin dropped on the map. None offline."""
    key = (round(lat, 5), round(lon, 5))
    if key in _reverse_cache:
        return _reverse_cache[key]
    url = "https://photon.komoot.io/reverse?" + urllib.parse.urlencode({"lat": lat, "lon": lon, "limit": 1})
    try:
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(request, timeout=6) as response:
            features = json.loads(response.read()).get("features", [])
    except Exception:  # noqa: BLE001 - a pin without a name is still a pin
        return None
    name = None
    if features:
        p = features[0].get("properties", {})
        street = " ".join(x for x in (p.get("street"), p.get("housenumber")) if x)
        named = p.get("name") and p.get("osm_key") not in ("highway", "place")
        name = p.get("name") if named else (street or p.get("name"))
    _reverse_cache[key] = name
    return name
