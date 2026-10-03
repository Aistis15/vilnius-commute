# Architecture: Vilnius Commute (a rebuild of Trafi's rider features)

Written by `/replica-architect` in the test run of 2026-10-03. The skill says
"use what the user already knows if they have a stack", so every row below is
the stack already in this repo, not the skill's defaults (Next.js, Supabase,
Stripe, Resend, Vercel). None of those fit: the README sets a 0 EUR budget, no
paid APIs, no accounts, and an iPhone build from Windows through CI.

## Stack

| layer | choice | why |
| --- | --- | --- |
| app | SwiftUI (`App/`, `Core/`) + Live Activity widget (`Widgets/`) | the banner is the interface (`docs/product-vision.md`) |
| prototype | standard-library Python server + plain JS (`prototype/`) | proves behaviour before a free Apple ID can sign the widget (D12) |
| database | SQLite built daily from GTFS (`Tools/gtfs`, `gtfs.yml`) | one file the phone and the prototype both route over |
| live data | stops.lt `gps_full.txt` + GTFS-Realtime | the only public live source |
| auth | none | no tickets, so no account; places stay on the phone |
| payments | none | no public ticket API |
| email | none | |
| jobs | GitHub Actions cron (`gtfs.yml` 03:20 UTC, `osm.yml` weekly) | free |
| hosting | GitHub Releases (`data-latest`) | free, versioned, hashed |

## Schema

Tables: 11 (`meta, stop, route, pattern, pattern_stop, service,
service_exception, trip, trip_time, pattern_shape, transfer`).
Access rules: none needed, the data is public and read-only.

The skill's schema rules (uuid keys, `timestamptz`, owner columns, row level
security, money in cents) are for a multi-user Postgres app. They do not apply
to a read-only GTFS SQLite on the phone. The one rule that does carry over is
"hard constraints live in the data, not the UI": cancelled trips are removed
in the planner (`skip=`), not hidden in the view.

## API (prototype server)

| method path | does | flow |
| --- | --- | --- |
| GET /api/plan | A to B options, depart or arrive by | F01, F02 |
| GET /api/search, /api/resolve | places, and a spoken request in one call | F01 |
| GET /api/nearby, /api/stop | departures around you, one stop's board | F03 |
| GET /api/vehicles, /api/live, /api/stream | live buses, a trip's rides, push updates | F04 |
| GET /api/walk | street path and turns for a walk | F01 |
| GET /api/shape | one line's street | F04 |

Webhooks: none. Jobs: timetable build daily, crossings weekly.

## The parts that bite

- time zones: Europe/Vilnius, local service days past midnight (night buses).
- realtime: vehicles matched to timetable trips; Kaunas's feed has no trip ids.
- offline: routing works on the downloaded copy; search, walking, live do not.
- rate limits: Photon and OSRM public servers.

## Build order

Already built. Next by `docs/trafi-analysis.md`: "Spėsi?", ghost-trip guard,
weather-aware walking. See `features.csv` rows with `original = no`.
