# Vilnius Commute — browser prototype

The whole product, working, before it can be installed on an iPhone: the
lock-screen button, the banner that asks "Kur keliausime šiandien?", voice in
Lithuanian, real routes on the real timetables of five cities (Vilnius, Kaunas,
Klaipėda, Šiauliai, Panevėžys), the banner changing as the trip goes on, the
Dynamic Island, "Ar baigėte kelionę?", unlimited saved places and the "you go
there often — save it?" prompt.

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
The first start downloads the timetables of all five cities in one file
(~6.7 MB) from the `data-latest` release; after that routing works offline.
Place search and speech need the internet.

### On the iPhone

The iPhone app (`App/`, installed from a Mac with Xcode: the `mac-kit`
build, see `docs/ios-shell.md`) shows this prototype full screen and draws
the banner as a real Live Activity. Double-click **`Paleisti-iPhone.bat`**:
it runs `server.py --lan` (or `--tunnel` when `cloudflared` is installed) and
opens <http://localhost:8765/connect>, a QR code the iPhone camera opens in
the app. The PC stays on while the phone uses it. `?shell=ios` tries the
phone layout on the desk.

## What is real and what is simulated

| Real | Simulated |
|---|---|
| Timetables, stops, routes, colours of five cities — the same SQLite the app uses | The phone frame, lock screen and Dynamic Island are drawn in HTML |
| Routing: RAPTOR from any point to any point, arrive-by, night service, the intercity coaches in the feeds | The clock can be sped up (panel on the right) to watch a trip unfold |
| Address and place search: Photon (OpenStreetMap), Lithuania-wide | "Balsas be mikrofono" stands in for a microphone when there is none |
| Lithuanian speech: the browser's recogniser + `vc/speech_lt.py` | Your location comes from the browser, or a place you pick |
| Live buses: stops.lt's positions and delays for Vilnius, Kaunas, Klaipėda (Panevėžys: positions only; Šiauliai publishes none), matched to timetable trips (`vc/live.py`) | Live data is used only while the clock panel is at the real time |

Saved places and preferences live in the browser's `localStorage`, never in
this repository.

## Layout

```
server.py          standard-library HTTP server: static files + /api/*
vc/data.py         download, verify (sha256 from the manifest) and load the timetables
vc/router.py       RAPTOR with walking access/egress, one option per number of rides
vc/planner.py      points -> options: arrive-by, later departures, ranking, tags
vc/search.py       stop names + Photon geocoder, ranked for where you are
vc/speech_lt.py    "Man reikia į Akropolį keturiolika dvidešimt" -> Akropolis, 14:20
web/               the app: index.html, style.css, app.js (no build step)
tests/             python -m unittest discover -s prototype/tests -t prototype
```

## Decisions worth knowing

- **Live delays move the plan, carefully.** A late bus moves its ride and
  everything after it; the walk to it starts later by the delay less a minute
  (buses make up time), and under two minutes late moves nothing. An early
  bus moves the walk earlier by all of it. A connection the new times break
  is marked, sorted last in the results, and the banner says "Nespėsi
  persėsti" with one button that plans the rest from that stop.
- **Directions are turns, not compass points.** Each walk of a trip gets its
  street path and turns from OpenStreetMap's foot router (`/api/walk`); the
  banner's arrow is bent by the turn's real angle ("↰ Kairėn · po 130 m"),
  a street that only changes its name is not a turn, and the round minimap
  turns with the phone so the path ahead always runs up. Offline, the walk
  is a straight line and the arrow says "Tiesiai".
- **Crossings are said where they are.** Each walk's path carries the
  OpenStreetMap node ids it passes (OSRM `annotations=nodes`); those tagged
  highway=crossing (`vc/crossings.py`, built weekly by `osm.yml`) become
  "Pereik gatvę per perėją · Šv. Jurgio g." at the right metre. Where two
  stops of one name face each other, the instruction says to cross to the
  other side; on one curb, "toje pačioje gatvės pusėje".
- **The banner's map is a real map**, OpenStreetMap under the path, on
  every page, turning with the phone; tapping it opens the big map with the
  trip and its next waypoint. Buses glide between 5-second fixes.
- **Time is picked on wheels**, like the alarm: nothing but places is typed.
- **A map, one tap from home.** Stops show once zoomed in far enough to
  tell apart; the buses in service move on it in their route colours
  (`/api/vehicles`). Tap a stop for its board (`/api/stop`), or anywhere
  for a pin with its address (`/api/reverse`) and "Keliauti čia".
- **Banner colourways are presets.** 21 of three colours each, contrast
  checked; route colours and the minimap never change with them.
- **The board at the stop is on the home screen** (`/api/nearby`): the three
  nearest stops, their lines and the next times, live where known.
- **Buses are drawn where they are now** (measured 2026-09-27, Vilnius,
  every bus once a second for 200 s):
  - How it was: a moving bus was shown a median 110 m from where it was
    (p90 207 m), 16.7 s behind.
  - The server polls stops.lt every 2 s while anyone looks. An unchanged
    file answers 304, with no body.
  - It pushes each change at once (`/api/stream`, server-sent events):
    0.85 s median from publication to the app.
  - Every position carries when it was measured and the speed then. The
    app moves the bus on along its line's street for that long, and holds
    it at its next stop.
  - Result: 17.4 m median for moving buses (p90 54 m), on the road.
  - The comparison scripts and numbers are in `docs/trafi-analysis.md`.
- **Lines follow the streets.** The feeds' `shapes.txt` is in the database
  (`pattern_shape`, thinned to 1 m, 1 184 of 1 184 patterns). Rides are
  drawn along it, and live buses are pulled onto it when within 40 m.
- **Walks follow footways.** A plan's walking paths are asked for the moment
  it is shown. A walk is never drawn as a straight line, which would cut
  through buildings; until its path arrives it is not drawn at all. The
  path is joined on to the door or the stop when the router ends up to 30 m
  short of it.
- **Called-off trips are said** (GTFS-Realtime `CANCELED`, read by
  `vc/gtfsrt.py` without the protobuf library):
  - The planner leaves them out.
  - Boards strike them through and say "23:31 atšauktas".
  - A trip under way that loses its bus says "Autobusas atšauktas" and
    offers another way.
- **The server is fast on this computer too.**
  - It listens on ::1 as well as 127.0.0.1: the browser tries "localhost"
    as ::1 first, which cost ~300 ms a request before.
  - It keeps connections open (HTTP/1.1).
  - It gzips text, and answers static files with 304 when unchanged.
  - Result: page ready in 41 ms (was 657 ms), requests in 2-17 ms.
- **Which ticket, said in the trip** ("Važiuosi 17 min: užteks 30 min
  bilieto · 1,00 €", where to buy it), by each city's rules as the
  operators publish them: Vilnius's time tickets, Kaunas's Žiogas e-ticket
  with one change in 30 min, Klaipėda's ticket a ride. A price is shown
  only where the operator's own page confirms it.
- **The design is the Design canvas's** ("Vilnius Commute Design", made
  2026-09-29 to Apple's iOS 27 resources), installed 2026-10-01:
  - Home leads with the voice card; a Liquid Glass tab bar holds Kelionė,
    Žemėlapis and Nustatymai; screens pushed on top hide it.
  - The map's own look is the canvas's map theme, drawn from OpenFreeMap's
    vector tiles by MapLibre inside Leaflet (`mapStyle()` in `web/app.js`),
    light and dark; without WebGL the OSM tiles are shown greyed.
  - The banner is data first (`bannerNow`, `bannerDirection`,
    `bannerRoute`) drawn by one template (`bannerHtml`): caption, title and
    detail on the left, the number block on the right, one line along the
    bottom clear of the corner. The iPhone app draws the same data.
- **Buses glide** (2026-10-02): the shown bus follows its prediction like a
  damped spring in metres along its street, with the prediction's speed
  fed forward. It never jumps or runs backwards (live: 0 % of frames, from
  0.5 % and 0.6 %), is drawn every frame, waits 8 s at a stop it reaches,
  and slows rather than stops when it is shown ahead. On the 200 s
  recording: 18.3 m median for a moving bus, shown standing 18 % of moving
  time. The server asks stops.lt every second while anyone looks.
- **Motion, everywhere it helps** (2026-10-02): the tab pill springs to its
  tab while the bar stays put; things that open grow to their height; a
  trip's line draws itself from where you board; buses fade in and out;
  your dot breathes; a colourway eases over; light and dark cross-fade.
  Both maps are made out of sight once the screen has been left alone for
  2.5 s, so the first open is instant. A swipe from the left edge goes
  back, followed by the finger; the trip sheet drags between three heights.
- **The page button is the banner's corner**: a quarter circle in the
  accent colour with the dots inside, 56 pt. A Live Activity takes taps on
  buttons, not swipes.
- **Help lives inside the app.** Nothing can be drawn over the lock screen
  or the island on an iPhone, so:
  - A five-page guide, swiped, explains the banner, its corner, its map, the
    island and the lock-screen button. It is shown once after the first
    questions, and from Settings.
  - In-app tips point at the microphone, places, map, time wheels and
    "Pradėti kelionę" the first time each is on screen. Tapping the
    highlighted thing works and moves the tips on.

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
- **"Be there by" never offers a trip that has already left.** `/api/plan`
  takes `now` (local time, like `at`); with `mode=arrive` it drops options
  that should have started more than a minute ago. When none is left it
  answers with the fastest way from now and `"late": true, "late_by_min"`:
  the app shows "Nespėsi iki 09:00 · anksčiausiai 09:22".
- **Intercity coaches are routed like any bus.** The coach stand is kept in
  reach even when a dozen city platforms are nearer (Vilnius AS by
  "Stotis"), and arrive-by looks back 12 hours between cities instead of 3.
- **Street words are one word, short or long.** OpenStreetMap writes
  "Katedros a.", people say "Katedros aikštė": matching treats aikštė/a.,
  gatvė/g., prospektas/pr., alėja/al., skersgatvis/skg. as equal, and a
  search with no sure answer asks Photon again with the other spelling.
