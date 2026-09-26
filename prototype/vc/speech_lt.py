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

ARRIVE_WORDS = {fold(w) for w in "būti būt atvykti atvažiuoti nuvykti nukakti iki".split()}
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
    man mums reikia reik reikės noriu norėčiau norečiau norim norime
    būti būt buti nuvykti nuvažiuoti važiuoti važiuoju vaziuoti keliauti
    keliausime eiti nueiti atvykti atvažiuoti nukakti išvykti išvažiuoti išeiti
    į i iki prie pas link ligi nuo kaip dabar šiandien rytoj
    valandą valanda valandai val minutę minučių min ir kad galėčiau
    ryto rytą ryte dienos popiet vakaro vakare vakarą nakties naktį
    pusę pusė pusei be po to pietų
    prašau gal nuvesk parodyk
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


def parse(text: str, now_minutes: int | None = None) -> Parsed:
    """`now_minutes` (minutes since midnight) resolves "pusę trijų" to 14:30
    rather than 02:30 when it is ten in the morning."""
    result = Parsed(text=text.strip())
    parts = re.split(r"(?i)\bpo\s+to\b", text, maxsplit=1)
    main = parts[0]
    then = parts[1] if len(parts) > 1 else ""
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

    words = [tokens[i] for i, f in enumerate(folded) if i not in used and f not in FILLER]
    if any(f in HOME_WORDS for f in folded):
        result.home = True
        words = [w for w in words if fold(w) not in HOME_WORDS]
        result.destination = "Namai"
        result.candidates = ["Namai"]
    if words and not result.home:
        phrase = " ".join(words)
        result.destination = phrase
        result.candidates = nominative_candidates(phrase)

    if then.strip():
        rest = parse(then, now_minutes)
        result.then = rest.destination
    return result


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


def nominative_candidates(phrase: str) -> list[str]:
    """Search terms for a place named in another grammatical case.

    "į Akropolį" is accusative; the place is called "Akropolis". A handful of
    endings covers the common cases, and the original is always kept.
    """
    # Longest endings first: "Žaliąjį" must become "Žaliasis", not "Žaliąjis".
    rules = [
        ("ąjį", ["asis"]), ("ąją", ["oji"]), ("ųjų", ["ieji"]),
        ("į", ["is"]), ("ą", ["as", "a"]), ("ę", ["ė"]), ("io", ["is"]),
        ("o", ["as"]), ("os", ["a"]), ("ės", ["ė"]), ("ų", ["ai", "os"]),
    ]

    def forms_of(word: str) -> list[str]:
        low = word.casefold()
        for ending, replacements in rules:
            if low.endswith(ending) and len(low) > len(ending) + 1:
                stem = word[: -len(ending)]
                return [stem + r for r in replacements]
        return []

    words = phrase.split()
    # Every word takes the case, adjectives included: "į Žaliąjį tiltą".
    first_choice = " ".join((forms_of(w) or [w])[0] for w in words)
    last_only = " ".join(words[:-1] + [(forms_of(words[-1]) or [words[-1]])[-1]])
    seen, out = set(), []
    for candidate in (first_choice, last_only, phrase):
        if fold(candidate) not in seen:
            seen.add(fold(candidate))
            out.append(candidate)
    return out
