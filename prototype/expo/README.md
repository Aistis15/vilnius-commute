# Vilnius Commute — Expo Go shell

A small Expo SDK 57 app that shows the browser prototype (`prototype/web`)
full screen on a real iPhone through **Expo Go** from the App Store, with no
Mac and no signing. It is a `react-native-webview` plus what a web page on a
phone lacks:

- real GPS and the compass (`expo-location`) behind `navigator.geolocation`;
- the real safe-area insets, so the page drops its drawn iPhone frame;
- `localStorage` mirrored into the app (`AsyncStorage`), so saved places
  survive a new Wi-Fi address or tunnel URL;
- the status bar colour following what the page shows.

## What Expo Go cannot do

The real lock-screen banner and the Dynamic Island are Live Activities.
ActivityKit needs a widget extension, which is native code that Expo Go
cannot load; that is the Swift app in `App/` + `Widgets/`. In the shell the
page keeps its **simulated** lock screen, reached inside the app. Location also
stops while the app is in the background, and the permission prompt shows
Expo Go's own text (the `NSLocationWhenInUseUsageDescription` in `app.json`
applies to a later development build only).

## Run it

Double-click **`prototype/Paleisti-telefone.bat`**. It starts
`python server.py` (unless port 8765 already answers), installs the packages on
the first run, and starts Expo **through a tunnel** (`npx expo start --tunnel`),
which works even on Wi-Fi that keeps devices apart. On a home network where the
phone and PC see each other, `Paleisti-telefone.bat lan` is faster.
Then scan the QR code with the iPhone camera; it opens in Expo Go.

Expo Go for iOS (SDK 57) opens a project only when the CLI and the app are
signed in to the same Expo account: the launcher runs `npx expo login` when
`npx expo whoami` says nobody is; on the phone, Expo Go › Home › the avatar
at the top right. Expo Go shows which side still needs it.

By hand, from this folder: `npm install`, then `npm run tunnel` or
`npm run lan`, with `python ../server.py` running.

## How the page gets to the phone

The Python server stays on the PC's loopback. `metro.config.js` adds a
middleware to the Metro dev server (via `server.enhanceMiddleware`, which
Expo CLI composes into its own stack) that passes every `/vc/*` request to
`http://127.0.0.1:8765`, with the `/vc` prefix removed. Bodies are streamed both
ways, so `/vc/api/stream` (server-sent events) arrives event by event; status
and headers (`ETag`, `Content-Encoding`, `Cache-Control`) pass unchanged, and
`If-None-Match` goes through, so 304s work. If the Python server is not running
the proxy answers 502 with a short Lithuanian page, or JSON for `/vc/api/*`.

The shell loads `<metro origin>/vc/?shell=expo`, where the origin is the one
Expo Go got the bundle from (`Constants.expoConfig.hostUri`; a tunnel host,
`*.exp.direct` or any host without a port, is used over https). `EXPO_PUBLIC_VC_URL` overrides it: a bare
origin gets `/vc/?shell=expo` appended, a full URL is used as given. The page
must therefore use relative URLs only (`api/plan`, not `/api/plan`).

## The message contract

Before any page script runs, `shellScript.js` is injected. It sets:

- `window.VC_SHELL = { kind: 'expo', insets: { top, right, bottom, left } }`
  and the CSS properties `--shell-top` / `--shell-bottom` on `<html>` (px).
- `navigator.geolocation` with `getCurrentPosition`, `watchPosition`,
  `clearWatch` behaving like the Web API (`timeout`, `maximumAge`, error codes
  1/2/3). It posts `{type:'geo-start'}` for the first watcher,
  `{type:'geo-stop'}` when the last one is cleared, `{type:'geo-once'}` for a
  single position.
- `localStorage` restored from the app's copy on the first load in the view
  (the page's storage is made equal to it; a reload keeps what the page wrote
  since), and every change posted as `{type:'store', op:'set'|'remove'|'clear',
  key, value}`.

The app answers with `webview.injectJavaScript`:

- `window.__vcShell.fix({latitude, longitude, accuracy, altitude,
  altitudeAccuracy, heading, speed, timestamp})` — about once a second while
  watched (`Accuracy.BestForNavigation`); `heading`/`speed` are `null` when iOS
  does not know them.
- `window.__vcShell.fail(code, message)` — 1 permission denied,
  2 position unavailable.
- `window.__vcShell.heading(deg, accuracy)` — true heading (magnetic when true
  is unknown), at most ~5 times a second after a turn of 2° or more, and the
  latest one again every second while the phone is still (iOS goes quiet then;
  the page drops a compass it has not heard from in 3 s).
  `accuracy` is in degrees like Safari's `webkitCompassAccuracy`: expo-location
  reports a calibration level, turned back into iOS's own thresholds
  (20 / 35 / 50°), or `-1` when uncalibrated. It sets
  `window.VC_SHELL.heading = {deg, accuracy, at}` and fires a `vc-heading`
  event on `window` with `detail: {deg, accuracy}`.

The page may post `{type:'chrome', dark: true|false}` — dark when the top of
the screen is dark — and the status bar turns light or dark to match. Unknown
message types and bad JSON are ignored.

Links to other sites open in Safari; the view only navigates within its own
origin (`about:` and `data:` pages and sub-frames are allowed).

## Known limits

- The PC must stay on with `Paleisti-telefone.bat` running; the app is served
  from it, not installed.
- The tunnel goes through Expo's shared ngrok account (`@expo/ngrok` is a dev
  dependency so no global install is needed); it can be slow or down.
- `lan` mode needs the phone and PC on the same network and the Windows
  firewall to let Node.js accept connections.
- Checked on the PC only: the proxy (pages, gzip, 304, event stream, 502), the
  iOS bundle building, and the injected script in a stub browser. How it
  behaves on an iPhone (http on a LAN address in the WebView, speech input in
  WKWebView) is still to be tried.
