import Foundation

/// The script the shell runs in the page before any of the page's own code
/// ("The message contract" in docs/ios-shell.md).
///
/// A port of `prototype/expo/shellScript.js`: the same geolocation and
/// storage shims, with `window.webkit.messageHandlers.vc.postMessage` in
/// place of React Native's bridge, `VC_SHELL.kind = 'ios'` and the `stream`
/// flag. Added here: `__vcShell.action(name)`, which the shell calls for a
/// tap on the banner, and `__vcShell.insets(...)` for a changed safe area.
enum ShellScript {

    struct Insets: Codable, Equatable {
        var top: Double
        var right: Double
        var bottom: Double
        var left: Double

        static let zero = Insets(top: 0, right: 0, bottom: 0, left: 0)
    }

    /// JSON that is also safe inside a `<script>` element and older JS parsers.
    static func literal(_ value: some Encodable) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value) else { return "null" }
        return String(decoding: data, as: UTF8.self)
            .replacingOccurrences(of: "<", with: "\\u003c")
            .replacingOccurrences(of: "\u{2028}", with: "\\u2028")
            .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
    }

    /// - Parameters:
    ///   - saved: `localStorage` as the page last left it, or nil when it
    ///     could not be read (then the page's own storage is kept).
    ///   - insets: the real safe areas, in points.
    ///   - stream: false where server-sent events cannot get through.
    static func source(saved: [String: String]?, insets: Insets, stream: Bool) -> String {
        let savedJSON = saved.map { literal($0) } ?? "null"
        return #"""
        (function () {
          if (window.__vcShell) return;
          var SAVED = \#(savedJSON);
          var INSETS = \#(literal(insets));
          function post(message) {
            try { window.webkit.messageHandlers.vc.postMessage(JSON.stringify(message)); } catch (e) { /* no shell */ }
          }
          function later(fn) { setTimeout(fn, 0); }
          function safely(fn, arg) {
            try { fn(arg); } catch (e) { later(function () { throw e; }); }
          }

          // ---- what the page reads to lay itself out
          window.VC_SHELL = { kind: 'ios', insets: INSETS, stream: \#(stream ? "true" : "false") };
          function applyInsets() {
            var root = document.documentElement;
            if (!root) return false;
            root.style.setProperty('--shell-top', INSETS.top + 'px');
            root.style.setProperty('--shell-bottom', INSETS.bottom + 'px');
            return true;
          }
          if (!applyInsets()) document.addEventListener('readystatechange', applyInsets, { once: true });

          // ---- localStorage mirrored to the app, so it outlives a changed address
          var local = null;
          try { local = window.localStorage; } catch (e) { /* storage off */ }
          var proto = window.Storage && Storage.prototype;
          if (local && proto) {
            var get = proto.getItem, set = proto.setItem, remove = proto.removeItem, clear = proto.clear;
            // Only on the first load in this view: a reload keeps what the page wrote since.
            var restored = false;
            try { restored = sessionStorage.getItem('vc.shellRestored') === '1'; } catch (e) { /* no session storage */ }
            if (SAVED && !restored) {
              try {
                for (var i = local.length - 1; i >= 0; i--) {
                  var old = local.key(i);
                  if (!Object.prototype.hasOwnProperty.call(SAVED, old)) remove.call(local, old);
                }
                Object.keys(SAVED).forEach(function (key) {
                  if (get.call(local, key) !== SAVED[key]) set.call(local, key, SAVED[key]);
                });
                sessionStorage.setItem('vc.shellRestored', '1');
              } catch (e) { /* full or blocked: the page starts with what is there */ }
            }
            proto.setItem = function (key, value) {
              var mine = this === local;
              var before = mine ? get.call(this, String(key)) : null;
              set.call(this, key, value);
              if (mine && before !== String(value)) post({ type: 'store', op: 'set', key: String(key), value: String(value) });
            };
            proto.removeItem = function (key) {
              var mine = this === local && get.call(this, String(key)) !== null;
              remove.call(this, key);
              if (mine) post({ type: 'store', op: 'remove', key: String(key) });
            };
            proto.clear = function () {
              var mine = this === local;
              clear.call(this);
              if (mine) post({ type: 'store', op: 'clear' });
            };
          }

          // ---- navigator.geolocation answered by the phone's GPS through the app
          var ERRORS = { PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 };
          var watchers = {};
          var watchCount = 0;
          var nextId = 1;
          var pending = [];
          var lastFix = null;

          function position(fix) {
            return {
              coords: {
                latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy,
                altitude: fix.altitude, altitudeAccuracy: fix.altitudeAccuracy,
                heading: fix.heading, speed: fix.speed,
              },
              timestamp: fix.timestamp,
            };
          }
          function failure(code, message) {
            var error = { code: code, message: message || '' };
            for (var name in ERRORS) error[name] = ERRORS[name];
            return error;
          }
          function freshEnough(options) {
            // maximumAge 0 (the default) never takes a cached fix, however new.
            var maxAge = options && options.maximumAge > 0 ? options.maximumAge : 0;
            return maxAge > 0 && !!lastFix && Date.now() - lastFix.timestamp <= maxAge;
          }
          function timeoutOf(options) {
            var t = options && options.timeout;
            return typeof t === 'number' && isFinite(t) && t >= 0 ? t : null;
          }

          var geolocation = {
            getCurrentPosition: function (ok, fail, options) {
              if (typeof ok !== 'function') return;
              if (freshEnough(options)) {
                var fix = lastFix;
                later(function () { safely(ok, position(fix)); });
                return;
              }
              var ask = { ok: ok, fail: fail, timer: null };
              var t = timeoutOf(options);
              if (t !== null) {
                ask.timer = setTimeout(function () {
                  var at = pending.indexOf(ask);
                  if (at < 0) return;
                  pending.splice(at, 1);
                  if (typeof fail === 'function') safely(fail, failure(3, 'Timeout expired'));
                }, t);
              }
              pending.push(ask);
              post({ type: 'geo-once' });
            },
            watchPosition: function (ok, fail, options) {
              var id = nextId++;
              if (typeof ok !== 'function') return id;
              var watcher = { ok: ok, fail: fail, got: false, timer: null };
              watchers[id] = watcher;
              watchCount += 1;
              if (watchCount === 1) post({ type: 'geo-start' });
              if (freshEnough(options)) {
                var fix = lastFix;
                later(function () {
                  if (watchers[id] !== watcher) return;
                  watcher.got = true;
                  safely(ok, position(fix));
                });
              }
              var t = timeoutOf(options);
              if (t !== null) {
                watcher.timer = setTimeout(function () {
                  if (watchers[id] === watcher && !watcher.got && typeof fail === 'function') {
                    safely(fail, failure(3, 'Timeout expired'));
                  }
                }, t);
              }
              return id;
            },
            clearWatch: function (id) {
              var watcher = watchers[id];
              if (!watcher) return;
              clearTimeout(watcher.timer);
              delete watchers[id];
              watchCount -= 1;
              if (watchCount === 0) post({ type: 'geo-stop' });
            },
          };
          try {
            Object.defineProperty(navigator, 'geolocation', {
              configurable: true, enumerable: true, get: function () { return geolocation; },
            });
          } catch (e) { /* the page keeps the browser's own */ }

          // ---- what the app calls with evaluateJavaScript
          window.__vcShell = {
            fix: function (fix) {
              lastFix = fix;
              var asks = pending.splice(0);
              asks.forEach(function (ask) { clearTimeout(ask.timer); safely(ask.ok, position(fix)); });
              Object.keys(watchers).forEach(function (id) {
                var watcher = watchers[id];
                if (!watcher) return;
                watcher.got = true;
                safely(watcher.ok, position(fix));
              });
            },
            fail: function (code, message) {
              var error = failure(code, message);
              var asks = pending.splice(0);
              asks.forEach(function (ask) {
                clearTimeout(ask.timer);
                if (typeof ask.fail === 'function') safely(ask.fail, error);
              });
              Object.keys(watchers).forEach(function (id) {
                var watcher = watchers[id];
                if (watcher && typeof watcher.fail === 'function') safely(watcher.fail, error);
              });
            },
            heading: function (deg, accuracy) {
              window.VC_SHELL.heading = { deg: deg, accuracy: accuracy, at: Date.now() };
              window.dispatchEvent(new CustomEvent('vc-heading', { detail: { deg: deg, accuracy: accuracy } }));
            },
            // A tap on the banner or a link that opened the app: trip, replan,
            // trip-done, trip-snooze, page:<n>. The page may replace this, or
            // listen for "vc-action".
            action: function (name) {
              window.dispatchEvent(new CustomEvent('vc-action', { detail: { name: name } }));
            },
            insets: function (insets) {
              INSETS = insets;
              window.VC_SHELL.insets = insets;
              applyInsets();
              window.dispatchEvent(new CustomEvent('vc-insets', { detail: insets }));
            },
          };
        })();
        """#
    }
}
