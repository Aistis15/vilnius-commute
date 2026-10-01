# The iPhone app as a shell around the prototype

Written 2026-10-01. The prototype (`prototype/`) is where the product lives:
routing, live buses, walks, tickets, the banner's every stage. Porting all of
it to Swift is weeks of work (`docs/iphone-plan.md`, step 3). Until then the
iPhone app shows the prototype's own screens in a `WKWebView` and does
natively only what a web page cannot:

- the **Live Activity**: the banner on the lock screen and the Dynamic
  Island, drawn by the widget extension;
- **GPS and the compass** (`CLLocationManager`): a page loaded over plain
  http on the home network is not a secure context, so WebKit would refuse
  `navigator.geolocation`; the shell supplies it instead;
- **storage that outlives the address**: `localStorage` mirrored into
  `UserDefaults`, so saved places survive a new Wi-Fi address;
- the status bar and the safe areas.

The page is served by `prototype/server.py` on the PC. The phone reaches it
on the same Wi-Fi (`python server.py --lan`), or through a tunnel.

## Installing it

A free Apple ID in Xcode on a Mac signs the app **and** its widget extension
with their own profiles, which Sideloadly could not (D12 in
`docs/decisions.md`). CI builds a ready Xcode project for that: the
`mac-kit` artifact (see `.github/workflows/build.yml`). Free provisioning
lasts 7 days, then the app is installed again from the Mac.

Checked 2026-10-01 on Apple's pages:

- Xcode 27 needs macOS Tahoe 26.6+ and an Apple silicon Mac; it debugs on
  iOS 17 and later. An Intel Mac on Tahoe uses Xcode 26.6.
  (developer.apple.com/xcode/system-requirements)
- A free account cannot have Push Notifications or **Time Sensitive
  Notifications**; App Groups and Background Modes are allowed
  (developer.apple.com/help/account/reference/supported-capabilities-ios).
  So the kit's project has no time-sensitive entitlement, and the Live
  Activity is updated by the app itself, never by push.
- Profiles last 7 days; up to 3 apps a device; 10 App IDs per 7 days
  (developer.apple.com/help/account/basics/about-your-developer-account).
  The app and its extension are 2 App IDs.

## Where the page comes from

- The address is kept in `UserDefaults` (`serverURL`), e.g.
  `http://192.168.1.23:8765` or `https://….trycloudflare.com`.
- It is set by opening `vilniuscommute://connect?url=<percent-encoded>`
  (the PC's connect page shows it as a QR code; the iPhone camera opens it),
  or typed on the shell's first screen.
- The page is loaded as `<serverURL>/?shell=ios`.
- `Info.plist`: `NSAppTransportSecurity › NSAllowsLocalNetworking = YES`
  (covers http to LAN IP addresses since iOS 17; Apple's docs) and the
  `vilniuscommute` URL scheme. WKWebView traffic needs no Local Network
  permission (TN3179).
- Server-sent events do not pass Cloudflare quick tunnels; the shell says so
  with `VC_SHELL.stream = false` and the page polls instead.

## The message contract

Before any page script runs, the shell injects a script
(`WKUserScript`, `.atDocumentStart`, main frame only). It is
`prototype/expo/shellScript.js` with `window.ReactNativeWebView.postMessage`
replaced by `window.webkit.messageHandlers.vc.postMessage`. It sets:

- `window.VC_SHELL = { kind: 'ios', insets: { top, right, bottom, left },
  stream: true|false }` and `--shell-top` / `--shell-bottom` on `<html>`.
- `navigator.geolocation` (`getCurrentPosition`, `watchPosition`,
  `clearWatch`), fed by the shell.
- `localStorage` restored from the shell's copy on the first load, every
  change posted.

### Page → shell

Every message is a JSON string posted to the `vc` handler.

| `type` | Fields | The shell |
|---|---|---|
| `geo-start` / `geo-stop` / `geo-once` | — | starts, stops, or takes one fix (`kCLLocationAccuracyBest`) |
| `store` | `op: set\|remove\|clear`, `key`, `value` | mirrors `localStorage` in `UserDefaults` |
| `chrome` | `dark: bool` | status bar light or dark |
| `activity` | `op: start\|update\|end`, `destination`, `palette`, `moments`, `page` | starts, updates or ends the Live Activity (below) |
| `listen` | `op: start\|stop` | optional: records and transcribes with whisper.cpp (`lt`), answers with `__vcShell.speech` |
| `native` | `screen: diagnostics` | opens the native diagnostics screen |
| `haptic` | `kind: light\|success\|warning` | a short haptic |

### Shell → page

By `evaluateJavaScript`:

- `window.__vcShell.fix({latitude, longitude, accuracy, altitude,
  altitudeAccuracy, heading, speed, timestamp})`, about once a second while
  watched;
- `window.__vcShell.fail(code, message)`, with 1 = permission denied and
  2 = position unavailable;
- `window.__vcShell.heading(deg, accuracy)`, true heading;
- `window.__vcShell.action(name)` for what was tapped on the banner or
  opened by a link: `trip` (show the trip), `replan`, `trip-done`,
  `trip-snooze`, `page:<n>`;
- `window.__vcShell.speech({ interim?, final?, error? })` (optional, with
  `listen`).

## The banner as data

The design's rule is one template: what to do and where on the left, how
long until the next thing on the right, and one line along the bottom. The
page computes that, and the web banner and the native banner both draw it.

```
BannerPage {
  stage: "countdown" | "walk" | "wait" | "ride" | "problem" | "arrive" | "done"
  caption: string                    // 13 pt, ink at 64 %: "Išeik", "Eik į stotelę", "Važiuoji"
  captionRoute?: Route               // a badge after the caption: "Važiuoji [3G]"
  title: string                      // the left's main line
  titleKind: "clock" | "text" | "question" | "problem"
                                     // clock: 32 semibold tabular; text: 20 semibold;
                                     // question: 26 bold; problem: 24 bold, red
  meta?: string                      // 15 pt, ink at 80 %
  metaIcon?: { turn: number } | "crossing" | null
                                     // a turn arrow at that angle (deg, + = right), or a zebra
  right?: { caption: string, value: string, unit?: string, until?: number }
                                     // the number block: "Liko" / "12" / "min";
                                     // until (epoch ms): count down to it natively
  foot?: { routes?: Route[], text?: string, progress?: number, ticks?: number[] }
  buttons?: [{ label: string, action: string, primary?: bool }]
                                     // actions: trip-done, trip-snooze, replan
}
Route  { name: string, color: "RRGGBB", text: "RRGGBB" }
Moment { at: number, pages: BannerPage[] }   // the banner from `at` (epoch ms) on
activity message {
  type: "activity", op: "start" | "update" | "end",
  destination: string,                       // "ISM" (ActivityAttributes, fixed)
  palette: { base, ink, accent, red },       // "#RRGGBB", the user's colourway
  moments: Moment[],                         // sorted by `at`; the first is now
  page: number                               // the page shown now
}
```

- **Why moments.** A web view's scripts stop soon after the app goes to the
  background, so the page cannot redraw the banner on a locked phone. It
  sends what the banner will say at each change still ahead (leave, board,
  get off, arrive) from the timetable and the live delays it knows. The
  shell switches to the right moment as time passes: from its location
  updates, which keep the app running during a trip (background location),
  and from `ActivityContent.staleDate`, set to the next moment's `at`. The
  numbers in between count down natively from `right.until`
  (`Text(timerInterval:)`). While the app is open the page sends a fresh
  `update` whenever the banner changes, with GPS-driven directions.
- **The corner button** turns pages without the page:
  `NextBannerPageIntent` (a `LiveActivityIntent`) shows the next of the
  current moment's `pages` and remembers the index.
- **Buttons.** `trip-done` ends the activity (`EndTripIntent`) and tells the
  page; `trip-snooze` moves to the next moment; `replan` is a `Link` to
  `vilniuscommute://replan`, which opens the app. A tap anywhere else opens
  `vilniuscommute://trip`.
- **The island** shows `captionRoute` or the first `foot.routes` badge
  (compact leading) and `right.value right.unit` (compact trailing); the
  minimal view shows the badge; the expanded view is the page itself.
- **Size.** One `BannerPage` plus the palette, well under ActivityKit's 4 KB.
  The moments live in the app's Application Support folder, where the
  intents (which run in the app's process) read them.

## Implementation notes (branch `ios-shell`, 2026-10-01)

Appended by the implementation; the contract above is unchanged.

- **Where it lives.** `App/Sources/Shell/` (address, injected script,
  location, model, web view, screens), `App/Sources/AppDelegate.swift`,
  `Core/Sources/Model/BannerPage.swift` (the types above, decoded leniently:
  an unknown `stage` or `titleKind` falls back, an unknown `metaIcon` is
  dropped), `Core/Sources/LiveActivity/TripBanner.swift` (moments, page
  turning, ActivityKit), `Core/Sources/LiveActivity/TripBannerViews.swift`
  (the banner and the island), `Shared/Intents/BannerIntents.swift`.
- **UIKit lifecycle.** The status bar follows `{type:'chrome'}` through the
  root view controller's `preferredStatusBarStyle`. SwiftUI's
  `preferredColorScheme` would have flipped the page's
  `prefers-color-scheme` too.
- **Added to the injected script**, beyond the Expo one:
  `window.__vcShell.action(name)` dispatches a `vc-action` event
  (`detail.name`) unless the page replaces the function;
  `window.__vcShell.insets(insets)` updates `VC_SHELL.insets` and the CSS
  properties and dispatches `vc-insets`. Banner taps made while no page is
  loaded are queued and delivered after the next load.
- **Moments on disk**: `Application Support/trip-banner.json`. The moment
  shown is the last one whose `at` has come, or a later one "Dar ne" moved
  to. A new moment starts on its first page. `staleDate` is the next
  moment's `at`. The app re-checks every 15 s while open and on location
  fixes (at most every 5 s) during a trip; GPS runs in the background only
  while a banner is up.
- **Heading accuracy**: iOS's degrees through expo-location's levels and back
  (≤20 → 20, ≤35 → 35, ≤50 → 50, else -1), so both shells send the same.
- **ATS**: `NSAllowsLocalNetworking` and also
  `NSAllowsArbitraryLoadsInWebContent` (WKWebView only), because Apple's page
  for the first says iOS 17 "no longer allows connections to IP addresses by
  default" without being explicit that the key restores them.
- **Not drawn natively**: the walk page's round minimap (a Live Activity
  cannot host a map, and a free account has no App Group to hand it a
  snapshot image), and `listen` (whisper.cpp from the page). The `wait`
  stage has no board; it uses the text template with the prototype's words.
- **The island's expanded view** is the page in Island.png's layout: when the
  bottom line ends in a clock time beside a clock title (`ISM 14:20` beside
  `Išeik 13:52`), the two clocks sit side by side on top and the countdown
  moves to the bottom line (`Liko 12 min`), as the board shows.
- **Mac kit**: `Tools/ci/build_mac_kit.sh`, spec `Tools/ci/mac-kit/project-kit.yml`
  (includes `project.yml`), steps in `Tools/ci/mac-kit/KAIP-ĮDIEGTI.txt`.
  Artifact `mac-kit`; on pushes to `main` also the release `mac-kit-latest`.
