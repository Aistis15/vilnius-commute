"""Understanding a spoken Lithuanian trip request.

"Man reikia į Akropolį keturiolika dvidešimt" -> destination "Akropolis",
arrive by 14:20. Works on the transcript, so it does not care whether the
words came from the browser's recogniser now or whisper on the phone later.

Matching is done on words with diacritics folded away: recognisers are not
reliable about "š" versus "s", and a missed hook must not lose the time.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field


def fold(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(c for c in decomposed if not unicodedata.combining(c))


# Every form a number takes when telling the time: nominative (keturiolika
# dvidešimt), ordinal accusative (aštuntą vakaro), genitive (pusę trijų, be
# penkiolikos).
_NUMBER_FORMS = {
    0: "nulis nuline nulinę",
    1: "vienas viena pirma pirmą pirmos vienos vieno",
    2: "du dvi antra antrą antros dvieju dviejų",
    3: "trys trečia trečią trečios triju trijų",
    4: "keturi keturios ketvirta ketvirtą ketvirtos keturiu keturių",
    5: "penki penkios penkta penktą penktos penkiu penkių",
    6: "šeši šešios šešta šeštą šeštos šešiu šešių",
    7: "septyni septynios septinta septintą septintos septyniu septynių",
    8: "aštuoni aštuonios aštunta aštuntą aštuntos aštuoniu aštuonių",
    9: "devyni devynios devinta devintą devintos devyniu devynių",
    10: "dešimt dešimta dešimtą dešimtos dešimties",
    11: "vienuolika vienuolikta vienuoliktą vienuoliktos vienuolikos",
    12: "dvylika dvylikta dvyliktą dvyliktos dvylikos",
    13: "trylika trylikta tryliktą tryliktos trylikos",
    14: "keturiolika keturiolikta keturioliktą keturioliktos keturiolikos",
    15: "penkiolika penkiolikta penkioliktą penkioliktos penkiolikos",
    16: "šešiolika šešiolikta šešioliktą šešioliktos šešiolikos",
    17: "septyniolika septyniolikta septynioliktą septynioliktos septyniolikos",
    18: "aštuoniolika aštuoniolikta aštuonioliktą aštuonioliktos aštuoniolikos",
    19: "devyniolika devyniolikta devynioliktą devynioliktos devyniolikos",
    20: "dvidešimt dvidešimta dvidešimtą dvidešimtos dvidešimties",
    30: "trisdešimt trisdešimta trisdešimtą trisdešimties",
    40: "keturiasdešimt keturiasdešimta keturiasdešimtą keturiasdešimties",
    50: "penkiasdešimt penkiasdešimta penkiasdešimtą penkiasdešimties",
}
NUMBERS = {fold(word): value for value, forms in _NUMBER_FORMS.items() for word in forms.split()}

ARRIVE_WORDS = {fold(w) for w in "būti būt būsiu būčiau atvykti atvažiuoti nuvykti nukakti atsidurti susitikti iki".split()}
DEPART_WORDS = {fold(w) for w in "išvykti išvažiuoti išeiti išeinu išvykstu išvažiuoju".split()}
HOME_WORDS = {"namo", "namus", "namai", "namuose"}
PART_OF_DAY = {
    "ryto": "am", "rytą": "am", "ryte": "am",
    "dienos": "pm", "popiet": "pm", "pietų": "pm",
    "vakaro": "pm", "vakare": "pm", "vakarą": "pm",
    "nakties": "night", "naktį": "night",
}
PART_OF_DAY = {fold(k): v for k, v in PART_OF_DAY.items()}

# Words that carry the request rather than the destination.
FILLER = {fold(w) for w in """
    aš man mums reikia reik reikės reiktų reikėtų noriu norėčiau norečiau norim norime
    turiu turėsiu turėčiau privalau būsiu būčiau atsidurti susitikti
    nusigauti nukeliauti patekti pasiekti vykti vykstu keliauju einu einam važiuojam važiuojame
    netoli šalia arti ties yra galėtum galėtumėte nuvesti parodyti rask rasti surask ieškok
    būti būt buti nuvykti nuvažiuoti važiuoti važiuoju vaziuoti keliauti
    keliausime eiti nueiti atvykti atvažiuoti nukakti išvykti išvažiuoti išeiti
    į i iki prie pas link ligi nuo kaip dabar šiandien rytoj
    valandą valanda valandai val minutę minučių min ir kad galėčiau
    ryto rytą ryte dienos popiet vakaro vakare vakarą nakties naktį
    pusę pusė pusei be po to pietų
    prašau gal nuvesk parodyk
""".split()}


# Words people say while they think ("universitete, kokiam nors, tarkim, ISM
# universitete"). Each ends what was said before it: the place is in the last
# stretch of words, the one the speaker settled on.
HESITATION = {fold(w) for w in """
    tenai ten tai nu na va tipo žinai tarkim tarkime pavyzdžiui pvz tiksliau
    koks kokia kokį kokią kokiam kokioj kokioje kokiame kažkoks kažkokia
    kažkokiam kažkokioje kažkur nors arba ar šitas šita šitam šitoj šitoje
    tas ta tą tam toj tame toje kur
""".split()}


@dataclass
class Parsed:
    text: str
    destination: str | None = None
    candidates: list[str] = field(default_factory=list)
    time: str | None = None           # "HH:MM"
    mode: str | None = None           # "arrive" | "depart"
    then: str | None = None           # a second destination after "po to"
    home: bool = False
    now: bool = False                 # "dabar": leave now, do not ask

    def as_json(self) -> dict:
        return self.__dict__.copy()


_TOKEN = re.compile(r"\d{1,2}[:.]\d{2}|\d+|[^\W\d_]+", re.UNICODE)


def _letter_runs(text: str) -> list[tuple[int, int, list[str]]]:
    """Letters spelled out one at a time, as (start, end, letters).

    Recognisers write an abbreviation said letter by letter as "i s m". Only
    single letters separated by spaces count: "M. K. Čiurlionio" keeps its
    initials. "į" with its hook is the preposition, never part of a name.
    """
    runs, current = [], []

    def close():
        letters = current[1:] if current and current[0].group().casefold() == "į" else current
        if len(letters) > 1:
            runs.append((letters[0].start(), letters[-1].end(), [m.group() for m in letters]))

    for match in _TOKEN.finditer(text):
        letter = len(match.group()) == 1 and match.group().isalpha()
        if letter and current and text[current[-1].end():match.start()].isspace():
            current.append(match)
            continue
        close()
        current = [match] if letter else []
    close()
    return runs


def spelled_readings(text: str) -> list[str]:
    """The text with spelled letters joined: "i s m universitetą" ->
    ["ISM universitetą", "i SM universitetą"].

    A leading plain "i" is either a letter or "į" without its hook. Three
    letters read as one abbreviation first (ISM); from four on, the "i" is
    more likely the preposition ("i k t u" -> "i KTU"). The other reading
    comes second, when there is one.
    """
    runs = _letter_runs(text)

    def build(flip: bool) -> str:
        out, last = [], 0
        for start, end, letters in runs:
            lead = ""
            if letters[0].casefold() == "i" and len(letters) >= 3:
                doubled = letters[1].casefold() == "i"   # "i i s m": preposition, then ISM
                if doubled or (len(letters) >= 4) != flip:
                    lead, letters = letters[0] + " ", letters[1:]
            out.append(text[last:start] + lead + "".join(letters).upper())
            last = end
        out.append(text[last:])
        return "".join(out)

    readings = [build(False)]
    if runs and build(True) != readings[0]:
        readings.append(build(True))
    return readings


def parse(text: str, now_minutes: int | None = None) -> Parsed:
    """`now_minutes` (minutes since midnight) resolves "pusę trijų" to 14:30
    rather than 02:30 when it is ten in the morning."""
    result = Parsed(text=text.strip())
    parts = re.split(r"(?i)\bpo\s+to\b", text, maxsplit=1)
    main = parts[0]
    then = parts[1] if len(parts) > 1 else ""
    main, *other_readings = spelled_readings(main)
    tokens = _TOKEN.findall(main)
    folded = [fold(t) for t in tokens]

    time, used = _find_time(folded)
    if time is not None:
        hour, minute, part = time
        hour = _resolve_hour(hour, minute, part, now_minutes)
        result.time = f"{hour:02d}:{minute:02d}"

    result.now = "dabar" in folded and result.time is None
    if any(f in DEPART_WORDS for f in folded):
        result.mode = "depart"
    elif result.time is not None or any(f in ARRIVE_WORDS - {"iki"} for f in folded):
        result.mode = "arrive"

    segments = _segments(tokens, folded, used)
    words = [w for segment in segments for w in segment]
    if any(f in HOME_WORDS for f in folded):
        result.home = True
        words = [w for w in words if fold(w) not in HOME_WORDS]
        result.destination = "Namai"
        result.candidates = ["Namai"]
    if words and not result.home:
        # The last stretch first: what the speaker settled on. All of it
        # together after, for a name the pauses happened to split.
        last = _settled(segments[-1])
        phrase = " ".join(last)
        result.destination = phrase
        result.candidates = nominative_candidates(phrase)
        whole = " ".join(words)
        if fold(whole) != fold(phrase):
            seen = {fold(c) for c in result.candidates}
            result.candidates += [c for c in nominative_candidates(whole) if fold(c) not in seen]
        # The other way to read spelled letters ("i v u": IVU or "į VU"),
        # searched only after the first reading.
        for reading in other_readings:
            other = _TOKEN.findall(reading)
            other_folded = [fold(t) for t in other]
            _, other_used = _find_time(other_folded)
            other_words = [other[i] for i, f in enumerate(other_folded) if i not in other_used and f not in FILLER]
            if other_words:
                seen = {fold(c) for c in result.candidates}
                result.candidates += [c for c in nominative_candidates(" ".join(other_words)) if fold(c) not in seen]

    if then.strip():
        rest = parse(then, now_minutes)
        result.then = rest.destination
    return result


def _segments(tokens: list[str], folded: list[str], used: set[int]) -> list[list[str]]:
    """The words that can name a place, in stretches split where the speaker
    hesitated. Request words ("man reikia būti") are dropped without ending a
    stretch; "ir" stays when it joins two words of a name ("Operos ir baleto
    teatras")."""
    segments: list[list[str]] = [[]]
    for i, (token, word) in enumerate(zip(tokens, folded)):
        if i in used:
            continue
        if word in HESITATION:
            if segments[-1]:
                segments.append([])
            continue
        if word == "ir":
            before = i > 0 and folded[i - 1] not in FILLER | HESITATION and (i - 1) not in used and segments[-1]
            after = i + 1 < len(folded) and folded[i + 1] not in FILLER | HESITATION and (i + 1) not in used
            if before and after:
                segments[-1].append(token)
            continue
        if word in FILLER:
            continue
        segments[-1].append(token)
    return [segment for segment in segments if segment] or [[]]


def _settled(words: list[str]) -> list[str]:
    """A name said twice keeps the second, fuller saying: "universitete ISM
    universitete" -> "ISM universitete"."""
    folded = [fold(w) for w in words]
    for i, word in enumerate(folded[:-1]):
        if word in folded[i + 1:]:
            return _settled(words[i + 1:])
    return words


def _number_at(folded: list[str], i: int) -> tuple[int, int] | None:
    """A number starting at token i, as (value, tokens consumed)."""
    if i >= len(folded):
        return None
    word = folded[i]
    if word.isdigit():
        return int(word), 1
    value = NUMBERS.get(word)
    if value is None:
        return None
    if value in (20, 30, 40, 50) and i + 1 < len(folded):
        unit = NUMBERS.get(folded[i + 1])
        if unit is not None and 1 <= unit <= 9:
            return value + unit, 2
    return value, 1


def _find_time(folded: list[str]) -> tuple[tuple[int, int, str | None], set[int]] | tuple[None, set[int]]:
    part = None
    part_index = None
    for i, word in enumerate(folded):
        if word in PART_OF_DAY:
            part, part_index = PART_OF_DAY[word], i

    def with_part(used: set[int]) -> set[int]:
        return used | ({part_index} if part_index is not None else set())

    for i, word in enumerate(folded):
        # 14:20, 14.20
        match = re.fullmatch(r"(\d{1,2})[:.](\d{2})", word)
        if match and int(match[1]) < 24 and int(match[2]) < 60:
            return (int(match[1]), int(match[2]), part), with_part({i})

        # pusę trijų -> 2:30
        if word in ("puse", "pusei") and (n := _number_at(folded, i + 1)):
            value, used = n
            if 1 <= value <= 12:
                return (value - 1, 30, part), with_part({i, *range(i + 1, i + 1 + used)})

        # be penkiolikos trys -> 2:45
        if word == "be" and (m := _number_at(folded, i + 1)):
            minutes, used_m = m
            if (h := _number_at(folded, i + 1 + used_m)) and 1 <= minutes < 60:
                hour, used_h = h
                if 1 <= hour <= 24:
                    span = range(i, i + 1 + used_m + used_h)
                    return (hour - 1, 60 - minutes, part), with_part(set(span))

    # keturiolika dvidešimt / aštuntą vakaro / 14 20
    for i in range(len(folded)):
        h = _number_at(folded, i)
        if not h:
            continue
        hour, used_h = h
        if not 0 <= hour <= 24:
            continue
        j = i + used_h
        if j < len(folded) and folded[j] in ("val", "valanda", "valandai"):
            j += 1
        m = _number_at(folded, j)
        # Hour and minutes in the same form, both digits or both words:
        # "Gedimino 9 keturiolika dvidešimt" is 14:20 at number 9, not 9:14.
        same_kind = m is not None and folded[i].isdigit() == folded[j].isdigit()
        if m and same_kind and 0 <= m[0] < 60:
            return (hour % 24, m[0], part), with_part(set(range(i, j + m[1])))
        # A lone number is only a time when something says so: an ordinal
        # form ("aštuntą"), a part of day, or "valandą".
        word = folded[i]
        is_ordinal = word.endswith("a") and not word.isdigit() and hour <= 24
        if part is not None or j > i + used_h or is_ordinal:
            return (hour % 24, 0, part), with_part(set(range(i, j)))
    return None, set()


def _resolve_hour(hour: int, minute: int, part: str | None, now_minutes: int | None) -> int:
    if part == "am":
        return hour % 12
    if part == "pm":
        return hour if hour >= 12 else hour + 12
    if part == "night":
        return hour if hour >= 18 or hour <= 5 else hour + 12
    if hour >= 13 or hour == 0:
        return hour
    # "pusę trijų" at ten in the morning means 14:30, not 02:30: pick the
    # next time the clock shows it.
    if now_minutes is not None:
        for candidate in (hour, hour + 12):
            if candidate < 24 and candidate * 60 + minute >= now_minutes - 5:
                return candidate
    return hour


# The endings a name's last word (the noun it is named after) takes in the
# cases a destination is said in, each with the nominative forms it can come
# from, likeliest first. Locative: "būti progimnazijoje, universitete,
# Akropolyje, Fabijoniškėse, Pašilaičiuose". Accusative: "į Akropolį". Genitive:
# "iki Akropolio, prie stoties, netoli turgaus". The longest ending wins.
NOUN_ENDINGS = {
    "uose": ["ai"], "ėse": ["ės"], "ose": ["os"],
    "oje": ["a"], "ėje": ["ė"], "yje": ["is", "ys"], "uje": ["us"],
    "džio": ["dis"], "čio": ["tis"], "ies": ["is"], "aus": ["us"], "io": ["is", "ys", "ius"],
    "ių": ["ės", "iai"], "ų": ["ai", "os", "us"],
    "į": ["is", "ys"], "ą": ["as", "a"], "ę": ["ė"], "es": ["ės"],
    "os": ["a"], "ės": ["ė"], "o": ["as"], "e": ["as"],
}
# Adjectives before it agree with it ("Žaliajame tilte", "Didžiojoje
# gatvėje"). A genitive before it ("Vilniaus", "Versmės", "Katedros") names
# whose it is and never changes.
ADJECTIVE_ENDINGS = {
    "ajame": ["asis"], "ojoje": ["oji"], "ąjį": ["asis"], "ąją": ["oji"],
    "ojo": ["asis"], "osios": ["oji"], "ųjų": ["ieji"], "uosiuose": ["ieji"],
}


def _forms(word: str, endings: dict[str, list[str]]) -> list[str]:
    low = word.casefold()
    for ending in sorted(endings, key=len, reverse=True):
        if low.endswith(ending) and len(low) > len(ending) + 1:
            return [word[: -len(ending)] + r for r in endings[ending]]
    return []


def nominative_candidates(phrase: str) -> list[str]:
    """Search terms for a place named in another grammatical case.

    "į Akropolį", "būti Versmės progimnazijoje", "iki Katedros aikštės": the
    places are called "Akropolis", "Versmės progimnazija", "Katedros aikštė".
    The last word is the noun that takes the case; adjectives before it agree
    with it; the rest are genitives that stay. The phrase as said is always
    the last candidate.
    """
    words = phrase.split()
    if not words:
        return []
    before = [(_forms(w, ADJECTIVE_ENDINGS) or [w])[0] for w in words[:-1]]
    heads = _forms(words[-1], NOUN_ENDINGS)
    seen, out = set(), []
    for candidate in [" ".join(before + [h]) for h in heads] + [phrase]:
        if fold(candidate) not in seen:
            seen.add(fold(candidate))
            out.append(candidate)
    return out
