# Test plan: Vilnius Commute prototype

Build: c75c2d6  Date: 2026-10-03  Env: local `prototype/server.py`, timetables
built 2026-10-03 (3 443 stops), Chromium via Playwright 1.56.1, browser clock
pinned to Monday 2026-10-05 08:00 Europe/Vilnius, location Cathedral Square.

Sandbox limits: Photon, OSRM, stops.lt, map tiles and the jsDelivr CDN are
blocked. The map libraries are served from npm copies of the same versions
(`e2e/fixtures.ts`); tiles are empty; live data is off, so every time shown
is timetable time.

Run: `cd replica/e2e && npm i && npx playwright test` (server on :8765).
`RAW=1` turns the known-bug markers off to see the raw failures.

Every spec fails on console errors, page errors and 5xx responses.

| case | flow | type | steps | expected | auto | result |
| --- | --- | --- | --- | --- | --- | --- |
| F01-H1 | plan a trip now | happy | search "Žaliasis tiltas", pick the stop, read options, start | options with 6G, a walk, a ticket price; trip on the island | e2e | pass |
| F01-E1 | | edge: no diacritics | type "zaliasis tiltas" | finds Žaliasis tiltas | e2e | pass |
| F01-E2 | | edge: very long input | 225 characters | text kept, still answers | e2e | pass |
| F01-E3 | | edge: emoji and accents | "🚌 Šeškinė ąčęėįšųūž" | kept, no errors | e2e | pass |
| F01-E4 | | edge: plan at hh:mm:45 | plan for now late in the minute | no option already "Reikėjo išeiti" | e2e | pass |
| F01-E5 | | edge: back mid-flow | results, then Atgal | home, search there | e2e | pass |
| F01-E6 | | edge: phone width | 390x844, `?shell=ios` | nothing wider than the screen | e2e | pass |
| F01-E7 | | edge: first visit tips | type during the home tour | focus and results kept | e2e | pass |
| F01-E8 | | edge: results left open | search at 08:00:40, wait past 08:01 | results still there | e2e | **fail: BUG-001** |
| F01-E8b | | the fix | same, with the one-line guard applied in the page | results still there | e2e | pass |
| F01-N1 | | negative: no internet | search "Akropolis" (needs Photon) | says address search needs internet | e2e | **fail: BUG-002** |
| F02-H1 | arrive by, said | happy | "Man reikia į Žaliąjį tiltą aštuonios trisdešimt" | Iki 08:30, every option arrives by 08:30 | e2e | pass |
| F02-E1 | | edge: digits | "Į Žaliąjį tiltą 8:30" | Iki 08:30 | e2e | pass |
| F03-H1 | when does my bus come | happy | tap the nearest stop | expands, lines, headsigns, minutes | e2e | pass |
| F04-H1 | the map | happy | Žemėlapis tab | map container shows | e2e | pass |
| F04-E1 | | edge: CDN down at start, back later | block CDN, wait, unblock, open map | map shows | e2e | pass |
| S-H1 | settings | happy | Nustatymai tab | places and trip preferences rows | e2e | pass |
| A11Y x6 | home, results, settings | axe, light and dark | scan `#app` | no violations | e2e | home **fail: BUG-003**; results, settings pass |
| C-01 | design | contrast | `contrast.py replica/design/tokens.json` | 0 AA failures | tool | **8 fail: BUG-004, 005, 006** |

Not run, needs a phone or the network: live delays and cancelled trips,
walking turns, address search, voice through the microphone, the Live
Activity, VoiceOver, offline on a real device.

Result: 23 specs, 19 pass, 4 fail as known bugs (marked `test.fail` with the
bug id). Three runs in a row, same result. Contrast: 24 pairs, 8 fail.
