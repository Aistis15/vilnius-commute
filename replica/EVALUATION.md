# The Replica skill, run end to end on this project

Date: 2026-10-03. Pack: [Jakeschincariol/replica-skill](https://github.com/Jakeschincariol/replica-skill)
at commit 77c9436 (v1.0, 11 skills, 6 Python tools, 57 own tests passing).
Original: Trafi. Clone: `prototype/` at c75c2d6.

## Verdict

**Worth keeping three of the eleven: `replica-test`, `replica-design`'s
contrast checker and `replica-diff`'s parity score.** Together they found 6
real bugs in an app that was already carefully built, with a suite that runs
green in 50 seconds. The other eight either repeat work you have already
done better (`docs/trafi-analysis.md` beats `/replica-entrepreneur`'s target
16x) or assume a product this is not: a clone to sell, on Next.js, Stripe and
a domain, through the App Store.

## Skill by skill

| skill | ran | what it produced here | useful here | notes |
| --- | --- | --- | --- | --- |
| recon | partly | `recon.md`, `features.csv` (30 rows) | low | Every live source blocked; screens inferred, not seen. Its best source, your own account, needs you at the keyboard. |
| architect | yes | `architecture.md` | none | Defaults (Next.js, Supabase, Stripe, Resend, Vercel) all wrong for a 0 EUR iPhone app; it says to keep your stack, and then has nothing to add. |
| design | yes | `design/tokens.json`, contrast report | **high** | `contrast.py` on your real palette: 8 of 24 pairs fail AA. axe flagged none of them. |
| build | n/a | | | Already built. |
| backend | n/a | | | No auth, payments or email by design. |
| test | **yes** | `test-plan.md`, `bugs.md`, 23 Playwright + axe specs | **high** | 6 bugs, each reproduced, with a fix verified in the page for the worst one. |
| diff | yes | `parity.md`: 86.8, must-haves 7/7 | medium | Honest score; shows the two gaps (line timetable, tap a bus). `imgdiff.py` had no Trafi screenshots to compare. |
| entrepreneur | no | `fixes.md` | low | Blocked from every review source. Its themes are English: 0 of 20 Lithuanian complaint phrases match. Your analysis already covers it. |
| brand | sweep only | `brand.json`, sweep: 14 hits | low | All 14 in research docs and comments. No `--exclude`, so it would block a launch on your own Trafi research. |
| launch | lint only | `launch/listing.json` | none | Not going to a store. `listing.py` itself works on Lithuanian text. |
| deploy | preflight only | `deploy.md` | low | Nothing to deploy to. The preflight is a decent summary page. |

## What it found (all reproduced, details in `bugs.md`)

1. **BUG-001 (S3): search results vanish while you read them.** Every minute,
   and whenever nearby departures reload, `refreshHome()` draws home over an
   open search. It hit 5 of 9 unguarded searches in one run. One line fixes
   it, and F01-E8b proves the fix in the page. **Fix this one first.**
2. **BUG-002 (S3): offline address search says "Nieko neradau"** instead of
   saying it needs the internet.
3. **BUG-004 (S3): settings values are 2.2:1 grey** (`--label3` as text).
4. **BUG-005 (S3): red problem text is 3.2-3.9:1.** "Nespėsi iki..." is the
   most important sentence in the app.
5. **BUG-006 (S4): white numbers on Klaipėda's orange lines and the L1
   ferry** at about 3:1. Pick the text by contrast; black gives 7:1.
6. **BUG-003 (S4): the add-place tile** has an ARIA role it cannot have.

The suite also confirms what works: the core loop from search to a started
trip, Lithuanian voice ("aštuonios trisdešimt" -> arrive by 08:30, every
option on time), accent-free search, the stop board, the map, phone width,
the ticket hint, and no console errors (the sandbox's blocked hosts aside).

## What the tools are worth

| tool | verdict |
| --- | --- |
| `contrast.py` | Keep. Found 8 failures axe did not flag: on the screens scanned, axe could not decide contrast for 19-25 elements each (glass layers, pseudo-elements), the settings values among them. Hex only: alpha tokens must be flattened by hand. |
| `parity.py` | Keep. Clear weighting, leaves out what you skip on purpose, separates your own features. |
| `imgdiff.py` | Weaker than claimed. The same screen in light and dark scores 81.7 ("close"), not 90+: "ignores colour" is only partly true. A different screen scores 27.5, so it does rank layouts. |
| `sweep.py` | Works, but needs an exclude list for research docs. |
| `listing.py` | Works on Lithuanian; counts and the name check are right. |
| `reviews.py` | Not usable here until `themes.json` is rewritten in Lithuanian. |

## What the skill text adds over Claude without it

Mostly discipline, and the discipline mattered:

- "Only report what you reproduced" moved two of my own hypotheses (a map
  that never recovers, tips stealing the search) to "to check" when the raw
  run did not confirm them.
- The severity scale and bug format made `bugs.md` actionable.
- The edge-case checklist (long input, emoji, back mid-flow, phone width,
  late in the minute) produced the cases that found BUG-001.

What it did not foresee: a sandbox without the CDN (the map libraries had to
be served from npm copies), a non-English market, and an app that is not for
sale.

## If you want to keep using it

Copy only these into the repo's `.claude/skills/`: `replica-test`,
`replica-design`, `replica-diff`. Re-run the suite after a change:

```bash
python prototype/server.py &          # timetables download on first start
cd replica/e2e && npm i && npx playwright test
RAW=1 npx playwright test             # known-bug markers off
```

## Limits of this run

- The sandbox reached only GitHub and package registries. Trafi, both stores,
  review sites, stops.lt (live data), Photon, OSRM, map tiles and jsDelivr
  were blocked. Every time in the tests is timetable time.
- Nothing was run on an iPhone: Live Activity, VoiceOver, the microphone and
  the lock-screen banner are untested.
- No code in `prototype/`, `App/` or `Core/` was changed.
