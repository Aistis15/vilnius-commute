# From the prototype to the iPhone

Written 2026-09-27, after the overnight gauntlet on the browser prototype.
The prototype (`prototype/`) is now the reference for behaviour and design;
this is the plan for making the iPhone app match it.

## Why the iPhone app waits

Everything the product is — the banner, the Dynamic Island, the lock-screen
button — lives in the widget extension. A free Apple ID installed through
Sideloadly signs that extension with the app's identity and no profile, so
iOS never runs it (measured on the phone, see D12 in `docs/decisions.md`).
Xcode, AltServer and Impactor would sign it correctly; the user chose to wait
for a paid account instead.

## Step 1 — the account (user)

- Apple Developer Program: **99 USD a year**, annual only, shown in euros
  when enrolling (developer.apple.com/support/purchase-activation, checked
  2026-09-26). Enrol from the Apple Developer app on the iPhone.
- Then create an **App Store Connect API key** (Users and Access → Keys) and
  add it to the repository as three GitHub Actions secrets: the key file,
  its key ID and the issuer ID. Claude must not handle the key itself.

## Step 2 — CI signs and uploads (Claude)

- `xcodebuild archive` with automatic signing driven by the API key
  (`-allowProvisioningUpdates` with `-authenticationKeyPath`,
  `-authenticationKeyID`, `-authenticationKeyIssuerID`), so the app and the
  widget extension each get their own identity and profile — the exact
  thing Sideloadly could not do.
- Export and upload to App Store Connect (`xcodebuild -exportArchive` with an
  upload destination), build number from the run number.
- `ITSAppUsesNonExemptEncryption = NO` in Info.plist (HTTPS only), so builds
  do not stop at the export-compliance question.
- Result: every push to `main` lands in **TestFlight** on the phone. No PC, no
  cable, no Sideloadly, no 7-day expiry (TestFlight builds last 90 days and a
  newer one always arrives first). Internal testing on your own account needs
  no App Review.

## Step 3 — what moves from the prototype into Swift

The prototype's Python and JavaScript are the specification. Each item keeps
the prototype's tests, ported.

| Area | Prototype | Swift today | To do |
|---|---|---|---|
| Data | 5 cities, 4,165 stops, `stop.city` | Loader already reads the merged DB unchanged (schema 1, columns by name) | Show the city in stop names; download the DB at runtime from `data-latest` (the app bundles none today) |
| Routing | `vc/router.py`, `vc/planner.py` | `RaptorRouter.swift`: stop to stop only | Point-to-point with walking access/egress; an extra vehicle must save 3 min; dominance filter; leave as late as the same arrival allows; walks merged; arrive-by with `late`; intercity look-back and coach stands |
| Places | `vc/search.py` ranking + confidence | — | MapKit search (native, free) with the same ranking rules: distinctive-word coverage, case endings, initials, street-word variants, no parcel lockers, bias to where you are; ask when ambiguous |
| Speech | browser recogniser + `vc/speech_lt.py` | whisper.cpp builds; model accuracy unknown | Port the parser with all its tests ("pusę trijų", "be penkiolikos trys", spelled letters "i s m"); measure whisper small/base on real phrases |
| Banner | `web/app.js` stages and pages | One countdown state | `TripContentState` gains the stage and the page; one template for every stage with the number block ("išvyksta po / 10 min / 08:10"); pages flipped by a `LiveActivityIntent` button (buttons are what Live Activities allow); ≤ 160 pt tall; "Ar baigėte kelionę?" with Taip / Dar ne |
| Lock screen | lock-screen button → question → voice | `StartBannerControl`, `AudioRecordingIntent` (built, never ran: unsigned extension) | Wire the control to "Kur keliausime šiandien?" + listening; `AudioRecordingIntent` must start the Live Activity first (Apple's rule) |
| Live buses | `vc/live.py` (stops.lt `gps_full.txt`, matched by GTFS trip id or route + start minute), `vc/departures.py`, `withLive` in `web/app.js` | — | Fetch the city's feed every 15 s while a trip runs or the board is on screen; same matching and "delay moves the plan" rules; push Live Activity updates on a change of delay or a broken connection |
| Walking directions | `vc/walking.py` (OSRM foot router), `turnArrow` / `minimapHtml` in `web/app.js`, heading from a panel slider | — | MapKit walking directions (`MKDirections`, free) for the path and turns; `CLLocationManager` heading for the minimap; draw the arrow and minimap with SwiftUI shapes (a Live Activity cannot host a map view). How often a Live Activity may be updated while the phone turns is to be measured on the device, not assumed |
| Crossings | `vc/crossings.py` + weekly `osm.yml` (7 272 OSM crossings of the three cities), matched by node id on the walk's path | — | Bundle the same `crossings.json.gz`; MapKit walking directions do not return OSM node ids, so match crossings to the MapKit polyline by position (within ~5 m) instead |
| Banner map | OSM tiles drawn in the minimap, turned with the phone; tap opens the app's map | — | A Live Activity cannot host a map view or load tiles itself: the app renders a map snapshot (`MKMapSnapshotter`) into the App Group and the activity shows it as an image. How often that image may change (turning with the phone) must be measured on the device before it is promised |
| Paging | the banner's corner: a quarter circle in the accent colour, dots inside, tapped | — | A Live Activity takes taps on buttons (App Intents), not swipes: the corner is one `Button(intent:)` clipped to a custom quarter-circle `Shape` |
| Help | a swiped guide inside the app; tips beside in-app controls | — | Nothing can be drawn over the lock screen or the island: the guide is an in-app page (`TabView`, page style), the tips are in-app popovers (TipKit) |
| Live buses | server polls every 2 s, pushes at once (server-sent events); each fix moved on along its line's street | — | The app cannot keep a socket open in the background: while the app is open, the same stream; for the Live Activity, the server sends ActivityKit push updates (APNs, needs the push key the user adds as a secret). Move the bus along the street with the same fix + speed + age rule |
| Streets | `pattern_shape` in the database (encoded polylines) | — | Already in the shared database; decode in Swift and draw with `MKPolyline` |
| Cancelled trips | GTFS-RT `CANCELED`, parsed without protobuf (`vc/gtfsrt.py`) | — | Decode on the server that sends the pushes, and send the phone a list of called-off trip ids |
| Location | `watchPosition`, best-fix, accuracy shown, snapped to the walk within 25 m | — | `CLLocationManager`, `kCLLocationAccuracyBest`; GPS outdoors is typically 5–15 m, which meets the 10–25 m target the user set; snap to the walking polyline the same way |
| Arrival | simulated clock | — | Real GPS: stage changes on position, arrival detection for the question |
| Design | tokens, motion roles, dark grey | Design system in Core | Port the motion roles (short, varied, reduced-motion aware) to SwiftUI animations |

## Step 4 — test on the phone

In order, each one a yes/no with a screenshot:

1. The app installs from TestFlight and opens.
2. Diagnostics → Pasirašymas: the extension has its own profile.
3. The "Vilnius" widget and the "Vilnius · Baneris" control appear in the galleries.
4. The lock-screen button puts up "Kur keliausime šiandien?" and listens.
5. "Man reikia į Akropolį keturiolika dvidešimt" → a trip, no unlock.
6. The banner changes by itself on a real trip: leave, walk, wait, ride, walk,
   "Ar baigėte kelionę?".
7. The Dynamic Island compact and expanded views match the banner.
8. Kaunas and Klaipėda trips route.
9. Battery over a morning of use; the banner survives the app being killed.

## Known gaps carried over

- Walking distance in the planner is straight line × 1.3; the walk itself
  follows the foot router's path once it is shown.
- Same-named stops far apart show identical labels (e.g. two "Slėnis").
- Map markers can cover labels.
- "Leave at" late at night cannot see the next morning's first service.
