# Recon map: Trafi (iOS + Android)

Scope: the rider's core loop in Vilnius: plan a trip A to B, see when the bus
really comes, follow it. Tickets are recorded but not cloned (see Out of scope).
For: Vilnius Commute, a personal app (see `README.md`). Not a product to sell.
Date: 2026-10-03

> **Test-run caveat.** This map was written by `/replica-recon` inside a cloud
> sandbox whose network policy blocks trafi.com, the App Store, Google Play
> and every review site. Nothing below was observed in the Trafi app itself.
> Screens and states are **inferred** from Trafi's public FAQ and store text
> (via web search) and from `docs/trafi-analysis.md`, which is your own
> research of 2026-09-27/28. The skill's best source, "the user's own
> account, driven by the user", was not available.

## Sources

| # | source | URL | notes |
| --- | --- | --- | --- |
| 1 | help center (FAQ, Vilnius) | https://info.trafi.com/site/faq/vilnius/en | route search, real-time schedules, tickets, map stops with earliest departures, tapping a vehicle shows its track and stops, card minimum 5 EUR, bank-link. Read via search snippets only. |
| 2 | marketing site | https://www.trafi.com/vilnius-app | multimodal planner (buses, trolleybuses, car-sharing, e-scooters, taxis), live buses on a map, buy and activate tickets. 5 cities. |
| 3 | App Store listing | https://apps.apple.com/us/app/trafi/id791973944 | blocked from the sandbox |
| 4 | Google Play listing | https://play.google.com/store/apps/details?id=com.trafi.android.tr | blocked from the sandbox |
| 5 | press on the update | https://madeinvilnius.lt/en/transport/public-transport/updated-with-a-smart-app/ | search snippet only |
| 6 | your research | `docs/trafi-analysis.md` | 1 644 Lithuanian store reviews, LRT and 15min press, stops.lt feed measurements |
| 7 | the user's own account | n/a | not available in this run |

## Core loop

Say where you are going, get the fastest trip on live times, and know when to
leave. Trafi's paying loop is tickets; the rider's loop is the trip.

## Screens (Trafi, inferred)

| ID | screen | route / how to reach | purpose | key components | states seen |
| --- | --- | --- | --- | --- | --- |
| S01 | Home / map | app start | stops around you, live vehicles | map, stop pins, vehicle markers, search field | not observed |
| S02 | Route search | search field on S01 | A to B, depart or arrive time | two place fields, time picker, results list | not observed |
| S03 | Route results | S02 submit | options with rides, walks, times | option cards, line badges, durations | not observed |
| S04 | Route detail | tap an option | step-by-step legs | leg list, map with path | not observed |
| S05 | Stop departures | tap a stop pin | next departures at a stop | departure rows, live markers | FAQ: "earliest departures from that particular stop" |
| S06 | Vehicle detail | tap a vehicle | its track and stops | line path, stop list | FAQ: "visible once clicked on a particular vehicle" |
| S07 | Tickets shop | tickets tab | buy a ticket | ticket types, prices, payment | FAQ: card min 5 EUR, bank-link |
| S08 | My tickets / activate | tickets tab | activate before boarding | ticket card, activate button | FAQ; reviews: "activation spins" |
| S09 | Account / login | profile | sign in, phone number | login form | reviews: logged out, lost passes |
| S10 | City picker | settings | switch city | city list | reviews: "opens in Vilnius in Kaunas" |

## Flows

```
F01 Plan a trip now (core loop)
    S01 -> S02 -> S03 -> S04
    happy path clicks: not counted (app not observed)
    edge: no route, walking too long, night service, cross-city destination

F02 Arrive by a time
    S02 (arrive mode, pick time) -> S03 -> S04
    edge: already too late, last bus gone

F03 When does my bus come
    S01 -> S05
    edge: live vs timetable time, cancelled trip, no live data

F04 Where is my bus
    S01 -> S06
    edge: vehicle without GPS, stale position

F05 Buy and ride (Trafi only, out of scope)
    S07 -> payment -> S08 activate
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| Line badge | bus, trolleybus, express, night | default | S03, S04, S05, S06 |
| Option card | best, other | default, selected, problem (missed change) | S03 |
| Departure row | live, timetable, cancelled | default | S05 |
| Place field | from, to | empty, typing, filled | S02 |
| Time picker | depart, arrive | default | S02 |
| Map | stops, vehicles, path | loading, filled | S01, S04, S06 |

## Inferred data model

```
Stop       id, name, lat, lon, platform code
           evidence: S01 pins, S05, GTFS stops.txt   confidence: high
Route      id, short name, colour, category (bus, trolleybus, express, night)
           evidence: badges, GTFS routes.txt          confidence: high
Trip       id, route, service day, stop times, shape
           evidence: S04, GTFS trips/stop_times       confidence: high
Vehicle    id, trip, position, bearing, delay, fix time
           evidence: S06, stops.lt gps_full.txt       confidence: high
Ticket     type (30/60 min, day...), price, bought_at, activated_at, valid_until
           evidence: S07, S08, FAQ                    confidence: medium
Account    phone number, payment methods, tickets
           evidence: S09, reviews                     confidence: medium
Favourite  place or stop                              confidence: guess
```

Relationships: Route 1-n Trip, Trip n-n Stop (stop times), Trip 1-0..1
Vehicle, Account 1-n Ticket.

## Feature matrix

See `features.csv`. Must: 7, should: 7, could: 1, skip: 5.
Rows Trafi does not have (original = no) are added by `/replica-entrepreneur`.

## Out of scope (cannot or should not be cloned)

- Ticket sales and activation: needs an agreement with the operator (JUDU,
  Kauno autobusai...). No public ticket API exists. Your app says which
  ticket and where to buy it instead.
- Car-sharing, e-scooters, taxis in the planner: partner integrations, their
  network.
- Accounts: only exist to hold tickets and cards. Nothing to sync without
  them.

## Size

Screens 10, flows 5 (4 in scope), entities 7. Hard parts: a real router
(RAPTOR over GTFS), live vehicle matching from stops.lt, map performance,
five cities' feeds. Size: **L** (a quarter). You have already built most of
it in `prototype/`.
