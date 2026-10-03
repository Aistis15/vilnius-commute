# Deploy checklist: Vilnius Commute

Date: 2026-10-03  Commit: c75c2d6  Go from user: **not asked: nothing was
deployed.** The app ships as a sideloaded `.ipa` from CI (README), with no
domain, no host, no store listing and no payments, so most of
`/replica-deploy` has nothing to act on. The preflight still ran.

## Preflight

- [x] e2e suite: 23 specs, 19 pass, 4 fail as known bugs (`test-plan.md`)
- [x] no open S1 or S2 bugs (open: 4 x S3, 2 x S4, `bugs.md`)
- [x] parity: all must-haves done (7/7), feature score 86.8
- [ ] rebrand sweep clean: **fails, 14 hits**, all in research docs and two
      code comments, none in anything a rider sees. Would block a public
      launch as the skill is written; irrelevant for a personal app.
- [ ] store listing: n/a (not going to the App Store). `listing.py` tried on
      a hypothetical listing in `launch/listing.json`: works.
- [x] prototype unit tests: 150 run, OK (4 skipped)
- [ ] production build: CI's job (`build.yml`), not run here
- n/a privacy policy and terms, account deletion, cookie banner: no accounts,
  no analytics, places stay on the phone

## Production, domain, watch

n/a. No database, no Stripe, no OAuth, no email, no domain, no DNS. The
skill's Step 5 (mobile) assumes a paid Apple developer account and TestFlight;
the README rules both out (free Apple ID, re-signed every 7 days).
