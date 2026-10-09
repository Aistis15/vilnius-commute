// The Expo Go shell: shows the prototype (served by the PC, proxied by Metro
// under /vc/) full screen, and gives the page what a web page on a phone
// lacks: GPS and compass through expo-location, the real safe areas, and
// storage that survives a changed address. See README.md for the contract.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, Linking, Platform, PlatformColor, Pressable,
  StyleSheet, Text, View, useColorScheme,
} from 'react-native';
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants from 'expo-constants';
import * as Location from 'expo-location';
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { shellScript } from './shellScript';

const STORE_PREFIX = 'web:';
const FRESH_MS = 10_000;           // a fix this recent answers getCurrentPosition
const HEADING_MIN_MS = 200;        // at most ~5 compass updates a second
const HEADING_MIN_TURN = 2;        // degrees
// iOS reports the compass only when it turns, so a phone held still goes
// quiet; the page drops a compass it has not heard from in 3 s.
const HEADING_REPEAT_MS = 1000;
// expo-location reports compass calibration as a level; iOS's thresholds
// (LocationUtils.swift) turn it back into degrees, as webkitCompassAccuracy has.
const COMPASS_DEGREES = { 3: 20, 2: 35, 1: 50 };

const DENIED = 'Vietos naudoti neleista. Ją galima įjungti telefono nustatymuose.';
const UNAVAILABLE = 'Vietos nustatyti nepavyko.';

/* The page lives on the same Metro server the phone got this bundle from:
   "192.168.1.5:8081" on Wi-Fi, "xxxx.exp.direct" through the tunnel. */
function pageUrl() {
  const override = process.env.EXPO_PUBLIC_VC_URL;
  if (override) {
    // A bare origin gets the usual path; a full address is used as it is.
    return /^[a-z]+:\/\/[^/]+\/?$/i.test(override)
      ? override.replace(/\/$/, '') + '/vc/?shell=expo'
      : override;
  }
  const host = (Constants.expoConfig?.hostUri || '').split('/')[0];
  if (!host) return null;
  const bare = host.replace(/:\d+$/, '');
  // A tunnel host comes without a port (a LAN one always has Metro's).
  const base = /\.exp\.direct$/i.test(bare) || bare === host ? `https://${bare}` : `http://${host}`;
  return `${base}/vc/?shell=expo`;
}

function originOf(url) {
  const match = /^([a-z][a-z0-9+.-]*:\/\/[^/?#]*)/i.exec(url || '');
  return match ? match[1].toLowerCase() : null;
}

function turned(a, b) {
  return Math.abs(((b - a + 540) % 360) - 180);
}

function fixFrom(location) {
  const c = location.coords;
  return {
    latitude: c.latitude,
    longitude: c.longitude,
    accuracy: c.accuracy,
    altitude: c.altitude,
    altitudeAccuracy: c.altitudeAccuracy,
    // iOS gives -1 for "unknown"; the Web API says null.
    heading: c.heading != null && c.heading >= 0 ? c.heading : null,
    speed: c.speed != null && c.speed >= 0 ? c.speed : null,
    timestamp: location.timestamp,
  };
}

async function loadSaved() {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(STORE_PREFIX));
    const pairs = await AsyncStorage.multiGet(keys);
    const saved = {};
    for (const [key, value] of pairs) {
      if (value != null) saved[key.slice(STORE_PREFIX.length)] = value;
    }
    return saved;
  } catch {
    return null;   // unreadable: the page keeps whatever it has
  }
}

const colors = Platform.select({
  ios: {
    background: PlatformColor('systemBackground'),
    label: PlatformColor('label'),
    secondary: PlatformColor('secondaryLabel'),
    tint: PlatformColor('systemBlue'),
  },
  default: null,
});

function palette(dark) {
  return colors || {
    background: dark ? '#000000' : '#ffffff',
    label: dark ? '#ffffff' : '#000000',
    secondary: dark ? '#ebebf599' : '#3c3c4399',
    tint: dark ? '#0a84ff' : '#007aff',
  };
}

export default function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const theme = palette(dark);
  const url = useMemo(pageUrl, []);
  const origin = originOf(url);

  const webRef = useRef(null);
  const savedRef = useRef(null);
  const storeQueue = useRef(Promise.resolve());
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState(url ? 'loading' : 'error');   // loading | ready | error
  const failedRef = useRef(false);
  const [barStyle, setBarStyle] = useState(null);                   // null: follow the scheme

  // Location state lives in refs: it changes often and draws nothing.
  const pageWatching = useRef(false);
  const subs = useRef(null);
  const starting = useRef(false);
  const lastFix = useRef(null);
  const lastHeading = useRef(null);     // the one the page has
  const latestHeading = useRef(null);   // the one the compass gave last
  const headingRepeat = useRef(null);
  const permission = useRef(null);

  useEffect(() => {
    loadSaved().then((saved) => { savedRef.current = saved; setLoaded(true); });
  }, []);

  // Rebuilt only for a fresh WebView, so it carries what the page last saved.
  const script = useMemo(
    () => (loaded ? shellScript(savedRef.current, {
      top: insets.top, right: insets.right, bottom: insets.bottom, left: insets.left,
    }) : null),
    [loaded, attempt, insets.top, insets.right, insets.bottom, insets.left],
  );

  const inject = useCallback((code) => {
    webRef.current?.injectJavaScript(`window.__vcShell && ${code};true;`);
  }, []);
  const sendFix = useCallback((fix) => inject(`window.__vcShell.fix(${JSON.stringify(fix)})`), [inject]);
  const failPage = useCallback(
    (code, message) => inject(`window.__vcShell.fail(${code}, ${JSON.stringify(message)})`),
    [inject],
  );

  // One question at a time: expo-location's requester keeps only the latest
  // caller while the prompt is up, and an earlier one would wait forever
  // (the page asks for a position and a watch at the same moment).
  const askPermission = useCallback(() => {
    if (!permission.current) {
      permission.current = Location.requestForegroundPermissionsAsync()
        .then(({ granted }) => granted, () => false)
        .finally(() => { permission.current = null; });
    }
    return permission.current;
  }, []);

  const sendHeading = useCallback((deg, accuracy) => {
    lastHeading.current = { deg, accuracy, at: Date.now() };
    inject(`window.__vcShell.heading(${deg.toFixed(1)}, ${accuracy})`);
  }, [inject]);

  const onHeading = useCallback((h) => {
    const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
    if (!(deg >= 0)) return;
    const accuracy = COMPASS_DEGREES[h.accuracy] ?? -1;
    latestHeading.current = { deg, accuracy };
    const last = lastHeading.current;
    if (last && Date.now() - last.at < HEADING_MIN_MS) return;
    if (last && turned(last.deg, deg) < HEADING_MIN_TURN && last.accuracy === accuracy) return;
    sendHeading(deg, accuracy);
  }, [sendHeading]);

  const stopWatching = useCallback(() => {
    subs.current?.position.remove();
    subs.current?.heading?.remove();
    subs.current = null;
    clearInterval(headingRepeat.current);
    headingRepeat.current = null;
    latestHeading.current = null;
  }, []);

  const startWatching = useCallback(async () => {
    if (subs.current || starting.current) return;
    starting.current = true;
    try {
      if (!(await askPermission())) {
        failPage(1, DENIED);
        return;
      }
      const position = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (location) => {
          const fix = fixFrom(location);
          lastFix.current = fix;
          sendFix(fix);
        },
        () => failPage(2, UNAVAILABLE),
      );
      let heading = null;
      try {
        heading = await Location.watchHeadingAsync(onHeading);
      } catch {
        // no compass: the page steers by the GPS course instead
      }
      subs.current = { position, heading };
      if (heading) {
        // The latest reading again while the phone is still (and any turn
        // the 200 ms limit held back), so the page keeps trusting it.
        headingRepeat.current = setInterval(() => {
          const latest = latestHeading.current;
          const last = lastHeading.current;
          if (latest && (!last || Date.now() - last.at >= HEADING_REPEAT_MS)) sendHeading(latest.deg, latest.accuracy);
        }, HEADING_REPEAT_MS / 2);
      }
      // The page stopped, or the app left, while this was starting.
      if (!pageWatching.current || AppState.currentState === 'background') stopWatching();
    } catch {
      failPage(2, UNAVAILABLE);
    } finally {
      starting.current = false;
    }
  }, [askPermission, failPage, sendFix, onHeading, sendHeading, stopWatching]);

  const answerOnce = useCallback(async () => {
    const fix = lastFix.current;
    if (fix && Date.now() - fix.timestamp < FRESH_MS) {
      sendFix(fix);
      return;
    }
    if (!(await askPermission())) {
      failPage(1, DENIED);
      return;
    }
    try {
      const next = fixFrom(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
      lastFix.current = next;
      sendFix(next);
    } catch {
      failPage(2, UNAVAILABLE);
    }
  }, [askPermission, failPage, sendFix]);

  // The microphone, asked for when the app opens: the page records the
  // words for the computer's Whisper (iOS has no Lithuanian recogniser), and
  // a web view can only record once the app itself may. Recording on in the
  // audio session, or iOS gives the web view silence.
  const askMicrophone = useCallback(async () => {
    try {
      const { granted } = await requestRecordingPermissionsAsync();
      if (granted) await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      return granted;
    } catch {
      return false;
    }
  }, []);
  useEffect(() => { askMicrophone(); }, [askMicrophone]);

  // No GPS or compass in the background; back on screen, carry on if asked.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'background') stopWatching();
      else if (next === 'active' && pageWatching.current) startWatching();
    });
    return () => { sub.remove(); stopWatching(); };
  }, [startWatching, stopWatching]);

  const keep = useCallback((op) => {
    storeQueue.current = storeQueue.current.then(op).catch(() => {});
  }, []);

  const onMessage = useCallback(({ nativeEvent }) => {
    let msg;
    try { msg = JSON.parse(nativeEvent.data); } catch { return; }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'geo-start':
        pageWatching.current = true;
        if (lastFix.current && Date.now() - lastFix.current.timestamp < FRESH_MS) sendFix(lastFix.current);
        startWatching();
        break;
      case 'geo-stop':
        pageWatching.current = false;
        stopWatching();
        break;
      case 'geo-once':
        answerOnce();
        break;
      case 'store': {
        if (typeof msg.key !== 'string' && msg.op !== 'clear') return;
        const mirror = savedRef.current;
        if (msg.op === 'set' && typeof msg.value === 'string') {
          if (mirror) mirror[msg.key] = msg.value;
          keep(() => AsyncStorage.setItem(STORE_PREFIX + msg.key, msg.value));
        } else if (msg.op === 'remove') {
          if (mirror) delete mirror[msg.key];
          keep(() => AsyncStorage.removeItem(STORE_PREFIX + msg.key));
        } else if (msg.op === 'clear') {
          if (mirror) for (const key of Object.keys(mirror)) delete mirror[key];
          keep(async () => {
            const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(STORE_PREFIX));
            await AsyncStorage.multiRemove(keys);
          });
        }
        break;
      }
      case 'chrome':
        setBarStyle(msg.dark ? 'light' : 'dark');
        break;
      case 'mic':
        // The page is about to record: ask again if it was not allowed yet.
        askMicrophone();
        break;
      default:
        break;
    }
  }, [answerOnce, askMicrophone, keep, sendFix, startWatching, stopWatching]);

  // Links to other sites open in Safari; the app itself stays in the view.
  const onShouldStart = useCallback((request) => {
    if (request.isTopFrame === false) return true;
    const target = request.url || '';
    if (target.startsWith('about:') || target.startsWith('data:')) return true;
    if (originOf(target) === origin) return true;
    Linking.openURL(target).catch(() => {});
    return false;
  }, [origin]);

  const onLoadStart = useCallback(() => {
    // A new document: its watchers start from nothing.
    failedRef.current = false;
    pageWatching.current = false;
    lastHeading.current = null;
    stopWatching();
  }, [stopWatching]);

  const onLoad = useCallback(() => {
    if (failedRef.current) return;
    setPhase('ready');
    // Only a recent fix: the page takes each one as where the phone is now.
    const fix = lastFix.current;
    if (fix && Date.now() - fix.timestamp < FRESH_MS) sendFix(fix);
  }, [sendFix]);

  const onFailed = useCallback(() => {
    failedRef.current = true;
    setPhase('error');
  }, []);

  const retry = useCallback(() => {
    setPhase('loading');
    setAttempt((n) => n + 1);   // a fresh WebView: reload() does nothing after a failed first load
  }, []);

  const statusStyle = phase === 'ready' && barStyle ? barStyle : dark ? 'light' : 'dark';

  return (
    <View style={[styles.fill, { backgroundColor: theme.background }]}>
      <StatusBar style={statusStyle} />
      {url && script ? (
        <WebView
          key={attempt}
          ref={webRef}
          style={styles.fill}
          source={{ uri: url }}
          injectedJavaScriptBeforeContentLoaded={script}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={onShouldStart}
          onLoadStart={onLoadStart}
          onLoad={onLoad}
          onError={onFailed}
          onHttpError={({ nativeEvent }) => { if (nativeEvent.statusCode >= 500) onFailed(); }}
          // A fresh view, not reload(): its script carries the storage as
          // the page last saved it, not as it was when this view opened.
          onContentProcessDidTerminate={retry}
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          bounces={false}
          allowsBackForwardNavigationGestures={false}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          allowsInlineMediaPlayback
          // The page records the words itself (iPhone has no Lithuanian
          // recogniser; the computer's Whisper hears them): no second prompt
          // on top of iOS's own microphone permission.
          mediaCapturePermissionGrantType="grant"
          keyboardDisplayRequiresUserAction={false}
          webviewDebuggingEnabled={__DEV__}
        />
      ) : null}
      {phase === 'loading' ? (
        <View style={[styles.cover, { backgroundColor: theme.background }]}>
          <ActivityIndicator size="large" />
        </View>
      ) : null}
      {phase === 'error' ? (
        <View
          style={[styles.cover, styles.error, {
            backgroundColor: theme.background, paddingTop: insets.top, paddingBottom: insets.bottom,
          }]}
        >
          <Text style={[styles.title, { color: theme.label }]}>Nepavyko atidaryti programėlės</Text>
          <Text style={[styles.body, { color: theme.label }]}>
            Kompiuteris turi būti įjungtas, o jame turi veikti Paleisti-telefone.bat.
          </Text>
          <Text style={[styles.body, { color: theme.secondary }]} selectable>
            {url ? `Adresas: ${url}` : 'Nepavyko sužinoti kompiuterio adreso.'}
          </Text>
          {url ? (
            <Pressable onPress={retry} hitSlop={12} accessibilityRole="button">
              {({ pressed }) => (
                <Text style={[styles.button, { color: theme.tint, opacity: pressed ? 0.4 : 1 }]}>
                  Bandyti dar kartą
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  cover: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  error: { paddingHorizontal: 32, gap: 12 },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  body: { fontSize: 17, textAlign: 'center' },
  button: { fontSize: 17, marginTop: 8 },
});
