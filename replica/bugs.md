# Bugs: Vilnius Commute prototype

Found by `/replica-test` and `/replica-design` on build c75c2d6, 2026-10-03.
Every bug below was reproduced; the specs named carry it. Nothing in
`prototype/` was changed: the fixes are proposals.

| id | severity | title |
| --- | --- | --- |
| BUG-001 | S3 | Search results vanish while you read them |
| BUG-002 | S3 | Offline address search says the place does not exist |
| BUG-003 | S4 | The add-place tile has a role it cannot have |
| BUG-004 | S3 | Settings values are 2.2:1 grey |
| BUG-005 | S3 | Red problem text is under 4.5:1 |
| BUG-006 | S4 | White numbers on Klaipėda's orange lines and the L1 ferry |

### BUG-001: Search results vanish while you read them

- Severity: S3 (the core loop's first step; workaround: type a letter again)
- Flow / case: F01 / F01-E8
- Screen: home, search open
- Build: c75c2d6  Browser / device: Chromium, 1440px and 390px

Steps
1. Open home, type "Žaliasis tiltas" in the search at 08:00:40.
2. See the result "Žaliasis tiltas · Stotelė".
3. Wait until 08:01:00.

Expected: the result stays until you pick it or cancel.
Actual: the search text and "Atšaukti" stay, but the results are replaced by
"Mano vietos" and "Šalia tavęs".
Evidence: `replica/bugs/BUG-001.png` (08:00:45: the nearby refresh got
there before the minute did). F01-E8 fails, F01-E8b (same steps, the fix
applied in the page) passes. Before the guard, 5 of 9 unguarded searches in
one run hit it at random.
Suspected cause: `refreshHome()` (app.js:729) morphs `#home-content` with
`homeContent()` without checking `state.searchActive`. Two callers fire it
while you search: the minute tick (app.js:4129) and every `/api/nearby`
answer (app.js:726: at start, after `/api/cities`, and from `pollLive`). The
GPS path already guards it (app.js:3279, `&& !state.searchActive`).
Fix: first line of `refreshHome()`:
`if (currentScreen().name !== 'home' || state.searchActive) return;`
Status: open

### BUG-002: Offline address search says the place does not exist

- Severity: S3 (visibly wrong; workaround: type a stop name)
- Flow / case: F01 / F01-N1
- Screen: home, search open

Steps
1. Without internet (Photon unreachable), search "Akropolis".

Expected: "Adresų paieškai reikia interneto. Stotelės randamos ir be jo." or
similar, with the stops that match.
Actual: "Nieko neradau pagal „Akropolis“."
Evidence: `replica/bugs/BUG-002.png`
Suspected cause: `search.places()` swallows the Photon error
(`vc/search.py:561`) and returns `[]`, so `/api/search` cannot tell "nothing"
from "could not ask".
Fix: return `"offline": true` from `/api/search` when Photon failed, and say
so in `searchResultsHtml`.
Status: open

### BUG-003: The add-place tile has a role it cannot have

- Severity: S4
- Flow / case: A11Y home (light and dark)
- Screen: home, "Mano vietos"

Expected: no axe violations. Actual: `aria-allowed-role` on `.ptile`
("ARIA role listitem is not allowed for given element").
Fix: put `role="listitem"` on a wrapper and keep the button a button.
Status: open

### BUG-004: Settings values are 2.2:1 grey

- Severity: S3
- Screen: Nustatymai, the values at the end of each row (`.row .trail`,
  e.g. the number of places, "Kuo greičiau")

Expected: 4.5:1. Actual: `--label3` #AEAEB2 on white 2.21:1, #636366 on
#2C2C2E in dark 2.33:1.
Evidence: `replica/design/contrast-report.txt`
Fix: `.row .trail { color: var(--label2) }`: 5.99:1 light, 5.42:1 dark.
iOS uses secondaryLabel there too.
Status: open

### BUG-005: Red problem text is under 4.5:1

- Severity: S3 (it carries the most important words: "Nespėsi iki…",
  "Autobusas atšauktas")
- Screens: results, trip, stop board (9 rules use `color: var(--red)`)

Actual: #FF3B30 on white 3.55:1, on the page grey 3.18:1, on the dark card
3.93:1. `late-title` is 17px/600, not large text.
Fix: a text red apart from the fill red: #D70015 in light (5.38:1 on white,
4.83:1 on the page), #FF6961 in dark (4.94:1 on the card).
Status: open

### BUG-006: White numbers on Klaipėda's orange lines and the L1 ferry

- Severity: S4 (the colours come from the feeds)
- Screens: every badge for Klaipėda M6, M8, 31, 116 (#FF6600) and Vilnius
  L1 (#00A59B)

Actual: white 15px bold on #FF6600 2.94:1, on #00A59B 3.06:1.
Fix: keep the feed's colour, pick the text by contrast (`luminance()` is
already in app.js:348): black gives 7.15:1 and 6.86:1.
Status: open

## To check (not reproduced)

- **Map libraries failing once.** `loadMapLibs()` caches a rejected promise
  (app.js:2191), which reads as "the map stays broken after a network blip
  until reload". F04-E1 tried it and the map came back, so not a bug as
  tested. On a phone that starts offline it may differ.
- **Tips over a search.** In one exploratory run the home tour opened over a
  search being typed. F01-E7 could not make it happen again.
- **"Reikėjo išeiti" on a fresh plan.** Seen once at 01:30 at night, on a walk
  planned for now. F01-E4 at 08:00:45 does not show it.
- **`--label2` on `--elevated` in dark** is 4.41:1. Fails only if
  secondary text sits on elevated sheets; not checked.
