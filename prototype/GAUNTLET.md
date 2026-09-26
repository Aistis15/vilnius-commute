# Overnight gauntlet — Vilnius Commute prototype

Started 2026-09-26 ~23:50. Build → render → critic (separate context) → fix the
biggest gap → repeat. Commit and push after every meaningful step so nothing is
lost if the session stops.

## Target (Phase 0)

Scope: app UI — phone frame (lock screen, banner, Dynamic Island, app screens).
The desk panel is secondary tooling.

Viewports: 1440×900 (phone frame on a desk) and 390×844 (phone browser: the
prototype goes full-screen below 440 px wide).

Sources of truth, in order:
1. The user's words: banner is the main UI, "easy as fuck"; no need to open the
   app; subtle, natural animation — alive but never unnatural; beautiful,
   intuitive, easy, accurate.
2. `docs/product-vision.md` (flow, banner content, saved places, "Ar baigėte
   kelionę?").
3. Native iOS 26 conventions: Live Activities, Dynamic Island, grouped lists,
   large titles, sheets, springs.

Hard constraints (from the spec, standing for this project):
- Monochrome base; the only saturated colour is transit colour (route badges),
  plus system red for problems. Dark mode is dark grey (#1C1C1E page, #2C2C2E
  cards), never pure black pages.
- No gradients, no glows, no emoji, no decorative icons.
- System type; tabular digits on every time and countdown; every number carries
  its unit ("12 min", "350 m", "14:20").
- Short, human Lithuanian copy. Grammar must be right (cases, plurals).
- Respect prefers-reduced-motion.
- Banner interactions must be possible on a real iPhone: buttons and toggles
  only — no swipe gestures inside a Live Activity. "Pages" flip by tapping.
- No personal data in the repo (saved places live in localStorage).

Standing rule: `ai-slop-checklist.md` (gauntlet skill) on every critic pass.

Priority: composition → typography → spacing → colour → motion → microinteractions.

## Backlog (top = next)

- [x] 1. Place accuracy: "ISM universitetą" must never become Vilniaus
      universitetas; letter-spelled abbreviations ("i s m"); ambiguous → the
      banner offers the two best matches as buttons.
- [x] 2. More cities: Kaunas, Klaipėda, Šiauliai, Panevėžys + Vilnius in one
      database (stops.lt feeds, same format). Search biased to where you are.
- [x] 3. Location that works on a PC and says why when it does not.
- [x] 4. Banner pages, flipped by tapping: trip / direction (arrow, bearing,
      distance) / whole trip.
- [x] 5. Start on the lock screen: the banner is the product.
- [x] 6. Motion system (first pass; the critic loop refines it): push/pop, banner stage changes, countdown roll, island
      spring, sheets, press feedback — varied timing, reduced-motion aware.
- [ ] 7. Critic loop on every screen until no top-priority discrepancy remains.
- [ ] 8. Wrap-up: `docs/iphone-plan.md` — developer account, TestFlight from CI,
      what moves from the prototype into Swift, test plan.

## Log

(one line per iteration: what the critic ranked first, what was fixed, commit)

- Round 1 (00:00–00:45): three parallel implementers. Five cities in one
  database (4,165 stops; published, Kaunas trips verified); "i s m
  universitetą" → ISM with high confidence, ambiguity flag; banner pages
  (Dabar / Kryptis / Visa kelionė), lock-first start, location help, motion
  system with a change-only DOM patcher. 59 tests pass. Commit 6010772.
- Round 2 (started 01:20): screenshots via prototype/tools/capture_flow.py
  (51 states, 0 console errors) → independent critic → frontend fixer on its
  top items; backend fixer in parallel: arrive-by never offers trips that
  already left ("late" response), aikštė↔a. variants, intercity routing.
