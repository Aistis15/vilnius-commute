# Fixes: what Trafi's riders hate, and this app

Written by `/replica-entrepreneur` in the test run of 2026-10-03.

## Sample

The skill's own collection step could not run: the App Store, Google Play,
Apple's review RSS feed, Reddit and Trustpilot are all blocked from the
sandbox. No reviews were collected, so `reviews.csv` and `feedback.md` do not
exist, and nothing here is quoted.

Your `docs/trafi-analysis.md` already does this job, past the skill's own bar:

| | skill asks | your analysis |
| --- | --- | --- |
| reviews | 100+ | 1 644 (320 App Store, 1 324 Google Play) |
| sources | 3+ | 2 stores + LRT, 15min, ve.lt press |
| recent first | yes | themes from 2024-2026 only, 123 reviews of 1-3 stars |
| counts per theme | yes | yes, shares of 123 |
| verbatim, linked quotes | required | paraphrased, no per-review links |

The one gap is the skill's hardest rule: every quote verbatim with its URL.
Your table paraphrases. For a personal app that is fine; for a pitch it would
not pass the skill's own check.

`reviews.py` would also not work on these reviews as shipped: its
`themes.json` is English. 0 of 20 Lithuanian complaint phrases ("stringa",
"neveikia", "nepavyksta pridėti kortelės", "po atnaujinimo", "trūksta"...)
match any pattern. A Lithuanian themes file on word stems is needed first.

## Three lists (from your analysis)

1. **What they hate:** tickets and payments (40%), real-time times wrong /
   ghost buses (21%), crashes and freezes (15%), route choice (11%).
2. **What is missing:** cancelled trips marked, holiday timetables, saving a
   daily route, VoiceOver.
3. **What is unsolved:** riders who cannot or should not tap through an app:
   a child going to school, blind riders after the 2023 redesign (LRT).

## Fix plan

Already rows in `features.csv` with `original = no`. Done: cancelled trips,
live vs timetable times, which ticket, holiday exceptions. Next by your own
order: "Spėsi?", then weather-aware walking. The ghost-trip guard stays held
back until Kaunas's matching is right.

## Angle

Not needed: the app is personal. If it ever were not:

> For Vilnius riders who were left standing by a bus that never came,
> Vilnius Commute tells you when to leave, and never offers a cancelled bus.
> Evidence: wrong real-time times, 21% of 123 recent 1-3 star reviews, 2 stores.
