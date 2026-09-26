# Vilnius Commute — browser prototype

The whole product, working, before it can be installed on an iPhone: the
lock-screen button, the banner that asks "Kur keliausime šiandien?", voice in
Lithuanian, real routes on the real Vilnius timetable, the banner changing as
the trip goes on, the Dynamic Island, "Ar baigėte kelionę?", unlimited saved
places and the "you go there often — save it?" prompt.

It exists because a free Apple ID cannot sign the widget extension the banner
lives in (see `docs/decisions.md`, D12). The iPhone app keeps being built in
parallel; this is where the design and behaviour are proven first.

## Run it

Double-click **`Paleisti.bat`**, or:

```
python prototype/server.py
```

then open <http://localhost:8765> in **Chrome or Edge** (they recognise
Lithuanian speech; Firefox does not). Nothing to install beyond Python 3.10+.
The first start downloads the timetable (~3 MB) from the `data-latest`
release; after that routing works offline. Place search and speech need the
internet.

## What is real and what is simulated

| Real | Simulated |
|---|---|
| Timetable, stops, routes, colours — the same SQLite the app uses | The phone frame, lock screen and Dynamic Island are drawn in HTML |
| Routing: RAPTOR from any point to any point, arrive-by, night service | The clock can be sped up (panel on the right) to watch a trip unfold |
| Address and place search: Photon (OpenStreetMap), Lithuania-wide | "Balsas be mikrofono" stands in for a microphone when there is none |
| Lithuanian speech: the browser's recogniser + `vc/speech_lt.py` | Your location comes from the browser, or a place you pick |

Saved places and preferences live in the browser's `localStorage`, never in
this repository.

## Layout

```
server.py          standard-library HTTP server: static files + /api/*
vc/data.py         download, verify (sha256 from the manifest) and load the timetable
vc/router.py       RAPTOR with walking access/egress, one option per number of rides
vc/planner.py      points -> options: arrive-by, later departures, ranking, tags
vc/search.py       stop names + Photon geocoder, ranked for Vilnius
vc/speech_lt.py    "Man reikia į Akropolį keturiolika dvidešimt" -> Akropolis, 14:20
web/               the app: index.html, style.css, app.js (no build step)
tests/             python -m unittest discover -s prototype/tests -t prototype
```

## Decisions worth knowing

- **An extra vehicle must save at least 3 minutes**, and options that are no
  better in any way are dropped. Without this RAPTOR offers "10, then 10 the
  other way, then 53" to arrive two minutes sooner.
- **Leave as late as still arrives on time.** At night the earliest arrival
  can mean leaving at 00:50 to wait four hours at a stop; the planner moves
  the departure as late as the same arrival allows.
- **Walking distance is straight-line × 1.3.** An estimate until walking
  directions exist; it errs towards promising too little time.
- **A spoken time means "be there by"** unless the words say otherwise
  ("išvykti", "išeiti"), matching the banner's "Išeik 13:52 · ISM 14:20".
