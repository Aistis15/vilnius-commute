# Trafi: where it fails its riders, and what this app does about it

Research of 2026-09-27/28. Everything below was measured or read, not
assumed; where a number comes from a sample, the sample is named.

## Method

- **Reviews.** Every Lithuanian review the stores would give:
  - App Store: 320 reviews, via Apple's public RSS feed (`itunes.apple.com/lt/rss/customerreviews`, app 791973944).
  - Google Play: 1 324 reviews, via `google-play-scraper`, for `com.trafi.android.tr`, language `lt`.
  - Google Play rating: **2.76 / 5 over 81 378 ratings**, 5 000 000+ installs.
  - App Store sample: 167 of the 320 reviews give one star.
  - Negative reviews peak in 2023 (265 of 1–2 stars): that is the year of the redesign ([ve.lt, 2023-02-22](https://ve.lt/verslas/atsinaujino-trafi-programeles-parametrai-nuo-siol-moketi-galima-tik-banko-kortele-daugiau)).
  - The themes below come from 2024–2026 only: 123 reviews of 1–3 stars. All of them were read, then counted by keyword (approximate: one review can carry several themes).
- **Press.**
  - [LRT](https://www.lrt.lt/naujienos/eismas/7/1957639/regejimo-negalia-turintys-zmones-kritikuoja-trafi-programele-anksciau-padedavo-savarankiskai-keliauti-dabar-net-ir-paklaidina) on blind riders after the redesign: the position no longer followed from stop to stop, stops were not announced, and it misled them.
  - [15min](https://15min.lt/mokslasit/straipsnis/technologijos/programele-trafi-susiduria-su-mokejimu-trikdziais-646-1288892) on payment failures.
- **The data behind any Lithuanian app.**
  - stops.lt's feeds, probed directly (`gps_full.txt`, GTFS, and the GTFS-Realtime feeds found at their standard names).
  - Recorded once a second for 200 s to measure what a rider sees.

## What riders complain about (2024–2026, 123 reviews of 1–3 stars)

| Share | Theme | In their words (paraphrased) |
|---|---|---|
| 40% | Tickets and payments | Cannot add a card (iOS 26). A €5 minimum purchase. Tickets lost after changing phone. Activation spins. Fined by inspectors. |
| 21% | Real-time times are wrong ("ghost buses") | "Shows it coming, then it disappears." "Says 5 min, comes in 15." "The stop's board and JUDU show another time." |
| 15% | Crashes, freezes, slowness | "Stringa." Waits on the start screen. |
| 11% | Route choice | Changes the suggested bus three times. Suggests a bus going the other way. Too little or too much walking. |
| 8% | Timetable changes and holidays | Holiday timetables are not shown, and the app does not say when they change. |
| 5% | Account and login | Logged out without warning. Changing a phone number loses paid passes. |
| 4% | Wrong city on start | In Kaunas, the app opens in Vilnius. |
| 2% each | Missing features | Cancelled trips not marked (Google Maps and m.Ticket mark them). Live buses gone from the map. Offline use and data sharing. |
| 1% each | Missing features | VoiceOver does not work. No way to save a daily route. |

## Each weakness, and this app

| Trafi weakness | This app (prototype) | Evidence |
|---|---|---|
| Ghost buses: shown, never come | **Cancelled trips** come from stops.lt's GTFS-Realtime feed (`CANCELED` trip updates, [vc/gtfsrt.py](../prototype/vc/gtfsrt.py)). The planner leaves them out. Boards strike them through and say "23:31 atšauktas". A rider on one is told "Autobusas atšauktas" and offered another way. | On 2026-09-27, line 46 had its 23:00 and 23:30 called off. The board at Skalvių st. showed "23:31 atšauktas". Our decoder matches Google's bindings with 0 differences over 485 trip updates and 220 vehicles. |
| Wrong times, jumping minutes | Every live time comes from the vehicle's own delay, pushed within a second of stops.lt publishing it. The app states which times are live and which are timetable. | Median 0.85 s (max 1.96 s) from publication to the app being told. Before: up to 5–10 s. |
| Buses in the wrong place | Each bus is drawn where it is now: moved on along its line's street for the age of its fix, and held at its next stop. | Moving buses: median error **17.4 m**, p90 54 m. Before: 110 m and 207 m. Same 200 s recording, about 21 000 samples. |
| Lines drawn through buildings | Rides are drawn along the feed's `shapes.txt` streets; walks along OpenStreetMap footways, fetched as soon as a plan is shown and never drawn as a straight line. | All 1 184 patterns have a street. 50 of 52 buses sit a median 1 m from their line. |
| Slow and freezing | The server answers in 2–17 ms: it listens on IPv6 too, keeps connections open (HTTP/1.1) and gzips responses. Skeletons appear at once. | Browser, before → after: page ready 657 → 41 ms, each request 265–313 → 2–17 ms, app.js 193 → 61 KB. |
| Wrong city on start | There is no city to switch: the city comes from where you are, and the home screen shows the stops around you. | — |
| Route flip-flopping, odd suggestions | The router offers one option per number of rides, and an extra ride has to save 3 min. Your preferences (fastest, one bus, fewest changes; walking limit) are asked once. | Existing planner tests. |
| Holiday timetables | The timetables are rebuilt from the feeds every day at 03:20 UTC, calendar exceptions included. | `.github/workflows/gtfs.yml` |
| Tickets and payments | No public API sells tickets, so the app does not sell them. **It says which ticket the trip needs and where to buy it**, by each city's own rules. | Checked on the operators' pages, 2026-09-28. [Vilnius (JUDU)](https://judu.lt/viesojo-transporto-keleiviams/bilietu-rusys-ir-kainos/): 30 min 1,00 €, 60 min 1,25 €, changes free. [Kaunas (KVT)](https://www.kvt.lt/en/tickets/ticket-fares/): Žiogas e-ticket 0,70 € with one change within 30 min; 1,50 € from the driver. [Klaipėda](https://www.klaipeda.lt/lt/naujienos/7654/patvirtintos-naujos-viesojo-transporto-bilietu-kainos:4885): 1,50 € from the driver. Its e-ticket price is not shown: the sources disagree (1,00 € / 0,70 €). |
| Login, lost passes | No account, no login: saved places stay on the phone. | — |
| Daily routes | Unlimited named places, each showing "when to leave" on the home screen. Places visited twice are offered for saving. | — |
| VoiceOver / blind riders | Controls carry spoken labels; the banner is text first, and a picture is never the only way to know. | Not yet tried with VoiceOver: a pass on the phone is due. |
| Live buses gone from the map | A map of all live buses in their line colours, moving continuously. | Markers move every frame: 29 of 29 samples at 10 Hz. |
| Offline | The iPhone app routes on the phone from its own copy of the timetables; live data and address search need the network. | — |
| Privacy | No analytics, no account; places stay in local storage. | — |

## Ideas from abroad, and whether they fit here

| App and idea | What it is | Here |
|---|---|---|
| Transit ([GO, crowdsourcing](https://blog.transitapp.com/ghost-bus-webinar-2022/)) | Riders' phones become the vehicle's position. Rate-my-ride. | Needs many users. Later: it fills gaps where a bus has no GPS. |
| Citymapper ([get-off alerts](https://citymapper.com/news/823/get-off-alerts)) | Vibrates before your stop. "Rain safe" routes. Commute alerts. | Get-off: the banner's ride stage; on the iPhone, an alert on the Live Activity. Rain: next (see below). |
| Google Maps ([crowdedness](https://blog.google/products/maps/grab-seat-and-be-time-new-transit-updates-google-maps/)) | Crowding forecasts. Live delays. | stops.lt publishes no occupancy. Delays: done. |
| SBB EasyRide / FAIRTIQ ([check-in/out](https://www.sbb.ch/en/travel-information/apps/sbb-mobile/easyride.html)) | Swipe in, swipe out, best price by the evening. | Needs the ticketing operators. Worth proposing to JUDU. |
| DB Navigator ([Komfort Check-in](https://int.bahn.de/en/booking-information/komfortcheckin)) | Check in on the phone instead of showing a ticket. | Same: the operator's side. |

## Not done anywhere we found: candidates for exclusives

In order of use to a rider, with what each needs:

1. **"Spėsi?"**
   - Your live walking position and pace, against the bus's live arrival at the stop: "Spėsi ramiai" / "Paspartink: 6 km/h" / "Nespėsi, kitas po 8 min".
   - Needs: done pieces (GPS snapping, live ETA). Build it next.
2. **Ghost-trip guard.**
   - A trip that should already be on the road but has no vehicle would be marked "nematomas".
   - Measured 2026-09-28 at 17:00, trips that had been on the road for over 3 minutes with no vehicle seen:
     - Vilnius: 6 of 419 (1%).
     - Klaipėda: 2 of 105 (2%).
     - Kaunas: 16 of 200 (8%). Kaunas's feed carries no trip ids, so part of that is likely matching, not missing buses.
   - Not built: a warning that is wrong one time in twelve in Kaunas would mislead. The ghost buses riders meet are mostly called-off trips (now shown) and timetable times shown as if live (the app marks live times apart).
3. **Weather-aware walking.**
   - Open-Meteo (no key): in rain or ice, less walking and a slower pace.
   - Citymapper has rain routes; nobody here does.
4. **Your own walking pace, learned** from the GPS on real walks (stored on the phone), instead of a fixed 1.35 m/s.
5. **Which ticket.** Done: "Važiuosi 17 min: užteks 30 min bilieto · 1,00 €", with where to buy it. Next: open the official app from that line on the iPhone.
6. **Holiday notice.** "Šiandien sekmadienio tvarkaraštis", from the feed's calendar exceptions.
7. **Wheelchair and pram.** The Vilnius GTFS-RT flags each vehicle `WHEELCHAIR_ACCESSIBLE`, so a departure can say whether the vehicle coming is low-floor.
8. **Share arrival.** "Būsiu 14:17" with the live delay, through the share sheet.
