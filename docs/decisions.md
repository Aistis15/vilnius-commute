# Decisions

Each entry records what was chosen, and — more usefully — what was checked
before choosing. Anything not verified says so.

---

## D1 · XcodeGen generates the project; no `.xcodeproj` in the repo

The development machine is Windows, so the project file can never be opened or
repaired locally. A hand-written `project.pbxproj` for an app plus a widget
extension plus an xcframework would be unreviewable and unfixable from here.

`project.yml` is the source of truth and CI runs `xcodegen generate`. XcodeGen
is a build-time tool, not an app dependency, so this does not conflict with the
"minimal dependencies" rule.

`.xcodeproj` is in `.gitignore` on purpose.

---

## D2 · `Core` is a static framework, and the Live Activity views live in it

Two constraints pushed the same way:

- A unit-test bundle cannot import an app extension. Anything that has to be
  snapshot-tested in CI must sit in something linkable.
- The app and the widget extension both need the `ActivityAttributes` type, and
  ActivityKit matches those across processes by type name.

So `Core` holds the model, the design system **and** the SwiftUI views for
every Live Activity state, and `Widgets/` is a thin shell that wires them into
an `ActivityConfiguration`. What CI renders is what the widget draws.

Built with `MACH_O_TYPE = staticlib` so neither target has to embed a dylib.

---

## D3 · whisper.cpp is built from source as an xcframework, pinned to v1.9.4

Checked at the tag, not assumed:

- `Package.swift` — **gone**. Swift Package Manager integration is not an option.
- Release assets for v1.9.4 — **none**. No prebuilt xcframework to download.
- `build-xcframework.sh` — present, and produces `build-apple/whisper.xcframework`
  with `framework module whisper`, so Swift sees `import whisper`.
- The module map already links `Accelerate`, `Metal`, `Foundation` and `c++`.

The framework is not committed (it is a large binary). CI builds it once and
caches it on the pinned tag plus the hash of the build scripts.

### D3a · The upstream build script is patched to iOS only

Upstream builds seven slices: iOS device, iOS simulator, macOS, visionOS,
visionOS simulator, tvOS, tvOS simulator. There is no flag to narrow it.

The GitHub macOS 26 runner image ships iOS, macOS, tvOS and watchOS SDKs but
**not visionOS**, so running it unmodified fails. Five of the seven slices are
also useless to an iPhone-only app.

`Tools/whisper/ios_only_patch.py` rewrites the script before it runs and
asserts its own output — if upstream restructures the script so the markers no
longer match, it exits non-zero instead of emitting something half-patched.
The transformation was run against the real v1.9.4 script while writing it:
91 lines removed, only the two iOS slices left, `bash -n` clean.

---

## D4 · Whisper models are downloaded at runtime, not bundled

The smallest useful multilingual model is 31 MB and the likely-useful one is
57 MB. Bundling would bloat an `.ipa` that has to be reinstalled every 7 days,
and would put a large binary in a public repo.

They are downloaded once into Application Support and survive re-signing. Sizes
were confirmed with range requests against huggingface.co rather than estimated:

| Model | Bytes |
|---|---|
| `ggml-tiny-q5_1.bin` | 32,152,673 |
| `ggml-base-q5_1.bin` | 59,707,625 |
| `ggml-small-q5_1.bin` | 190,085,487 |

The download is size-checked before it is committed to disk, because a
truncated model opens successfully and then fails inside whisper with an
unhelpful error.

Which model is good enough for Lithuanian is **not decided** — that is what the
Balsas screen measures.

---

## D5 · The App Groups entitlement is kept out of the default build

An entitlement a free Apple ID cannot provision makes the install fail
outright. If that entitlement were in the only build, a failure would take the
entire go/no-go with it.

So CI produces two `.ipa`s and the risky one is clearly labelled. See
`docs/capability-probe.md`, including the finding that an unsigned `.ipa`
carries no entitlements at all.

---

## D6 · Snapshots are captured through a real `UIWindow`

`ImageRenderer` only draws what SwiftUI lays out itself. `List` and
`NavigationStack` are UIKit-backed and come out blank, which would make every
app-screen snapshot an empty rectangle — worse than no snapshot, because it
looks like evidence.

`Tests/SnapshotTests/SnapshotHarness.swift` hosts each view in a key
`UIWindow`, forces layout, and captures the hierarchy. PNGs are written to
`artifacts/snapshots/` via a `#filePath`-relative path, which works because an
iOS Simulator process can write to host paths.

These are not assertions. Nothing is compared to a stored reference; they exist
so the UI can be reviewed by eye, which is the only visual QA available without
a Mac.

---

## D7 · Times are formatted 24-hour verbatim, not by locale

Lithuanian uses a 24-hour clock, but a device set to 12-hour overrides a
locale-driven format style and would print `1:52 PM` in the middle of
Lithuanian copy. `TimeFormat` pins the format with
`Date.VerbatimFormatStyle`.

Every time and countdown uses `.monospacedDigit()`, per the design rules, so
digits do not jitter as they tick.

---

## D8 · Route colour resolves on strings, not on `Color`

`RouteRef.effectiveBackgroundHex` decides "feed colour wins, fallback only when
the feed is missing or malformed" in terms of hex strings, and `Color` is
derived from that. `Color` equality is not dependable enough to assert against
in tests, and this rule is one that has to be tested.

The fallback table holds exactly the values recorded in the spec snapshot and
is marked provisional. **It has not been checked against the live feed** —
Phase 2 inventories the real `routes.txt`, and the spec already flags the
night-bus entry as stale.

---

## Open, not decided

- **App icon.** There is no asset catalog yet, so the app shows a blank icon on
  the home screen. Deliberate: Phase 1 ships no invented artwork, and an empty
  `AppIcon` set would produce the same blank icon with extra ceremony.

- Which whisper model is accurate enough for Lithuanian. Needs a device.
- Whether transcription can complete while the phone is locked. Needs Phase 5.
- Every route category, colour and `route_id` prefix in the live feed. Phase 2.
- Real badge geometry against Trafi reference screenshots. Phase 2.
