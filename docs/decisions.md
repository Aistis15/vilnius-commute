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

## D9 · The Live Activity is tracked by id, not by holding the object

`ActivityKit.Activity` is a class conforming to `Identifiable` and nothing
else — it is **not** `Sendable` — while `update` and `end` are `nonisolated
async`. Holding one in main-actor state and awaiting a method on it sends
main-actor-isolated state out of its isolation domain, and Swift 6 rejects it:

```
error: sending 'activity' risks causing data races
    await activity.update(...)
```

So `TripActivityController` stores only the activity's `id` and re-finds it
from `Activity.activities` inside `nonisolated` helpers, where the value is
local and visibly unshared.

This is also the more correct design independently of the compiler: a Live
Activity outlives the app process, so an id survives a relaunch and a stored
reference does not. `adoptRunningActivity()` uses that to re-attach.

---

## D10 · What the snapshots do and do not prove

The rendered PNGs caught two real defects on first review, which is the whole
reason the loop exists:

- Every non-full-screen render was clipped. The `UIWindow` inherits a
  status-bar-sized top safe-area inset, which pushed content down and out of
  frame — badges lost their numbers entirely. Fixed by setting
  `safeAreaRegions = []` for anything smaller than a full screen, *before*
  measuring, since the inset also changes the fitting size.
- Every countdown drew `Liko 00:00`. The pinned epoch used for determinism was
  in the past, and `Text(timerInterval:)` renders against the real clock, so
  every range clamped. The clamp is correct — it is what stops the range
  inverting and trapping — but it made the picture worthless. Sample times are
  now relative to `Date.now`.

Two limits to keep in mind when reading them:

- **Vibrant and accented renders are a simulation.** Setting
  `\.widgetRenderingMode` makes our own view take the monochrome path, which
  is what needs checking. It does not reproduce the system's own tinting of an
  accessory widget. Only a device shows that.
- **Navigation titles render washed out.** The nav bar's scroll-edge
  appearance has not resolved at capture time. An artifact of the harness, not
  of the app.

---

## D11 · Dark mode uses a dark grey page, not pure black

iOS draws grouped content on pure black in dark mode — `#000000` page with
`#1C1C1E` cards, which is what Settings.app looks like. This app moves both up
one step on iOS's own grouped-background ladder:

| | light | iOS dark | here |
|---|---|---|---|
| page | `#F2F2F7` | `#000000` | `#1C1C1E` |
| card | `#FFFFFF` | `#1C1C1E` | `#2C2C2E` |

Light mode is unchanged. These stay system colours rather than hardcoded hex,
so they still track Increase Contrast and any future OS adjustment.

`Color.pageBackground` / `Color.cardBackground` and the `commuteListChrome()`
modifier in `Core/Sources/Design/Backgrounds.swift` are the single place this
is expressed. The modifier has to hide the scroll content background first —
otherwise `List` paints its own system background over the top and nothing
changes.

---

## D10 · Snapshots pick a renderer; neither one is correct for everything

D6 said snapshots go through a real `UIWindow`. That is still right for app
screens, but it is not right for everything, and finding that out cost two
wrong "fixes" to code that was never broken.

The route badge knocks its number out of a filled shape with
`blendMode(.destinationOut)` inside a `compositingGroup`. SwiftUI implements
both as CALayer compositing filters, and `drawHierarchy(_:afterScreenUpdates:)`
flattens them. So every vibrant badge rendered as a featureless white blob —
and the badge code was correct the whole time.

Rendering the same view through both renderers settled it in one run:

| Renderer | Knocked-out badge | `List` / `NavigationStack` |
|---|---|---|
| `drawHierarchy` (window) | blank blob | correct |
| `ImageRenderer` (SwiftUI) | correct | draws nothing |

So `SnapshotHarness.Renderer` is a parameter and the caller chooses: app
screens use `.window`, anything with a blend mode uses `.swiftUI`.

`ImageRenderer` draws onto transparency, so that path composites an explicit
black or white backdrop — for a knocked-out glyph the backdrop is the point,
since it is what shows through the number.

**The lesson worth keeping:** when a render looks wrong, the harness is a
suspect too. Changing the code first, twice, was the wrong order.

---

## D11 · The CI simulator is discovered per run, never pinned

A pinned `name=iPhone 17,OS=26.5` destination failed the build the moment the
GitHub runner image rolled — and the replacement image shipped **no**
pre-created simulators at all, only placeholder destinations, so matching on
name alone would not have helped either.

`Tools/ci/pick_simulator.sh` picks the newest iOS runtime with an available
iPhone and addresses it by UDID. If the image has no devices it creates one;
if it cannot, it fails with the device-type listing attached so the next
failure explains itself.

It is a script rather than inline YAML because the first attempt embedded
Python in a `run:` block and broke the workflow parse.

---

## Open, not decided

- **App icon.** There is no asset catalog yet, so the app shows a blank icon on
  the home screen. Deliberate: Phase 1 ships no invented artwork, and an empty
  `AppIcon` set would produce the same blank icon with extra ceremony.

- Which whisper model is accurate enough for Lithuanian. Needs a device.
- Whether transcription can complete while the phone is locked. Needs Phase 5.
- Every route category, colour and `route_id` prefix in the live feed. Phase 2.
- Real badge geometry against Trafi reference screenshots. Phase 2.

## D12 · Install with AltStore, not Sideloadly

**Finding, measured on the phone** (Diagnostics → Pasirašymas, Sideloadly
v0.60, free Apple ID, iOS 27.0):

```
Plėtinys: com.vilniuscommute.app.<TEAM>.widgets
[!!] parašas: <TEAM>.com.vilniuscommute.app.<TEAM>  ← NESUTAMPA su bundle id
[!!] profilis: NĖRA
```

Sideloadly signs the widget extension with the *app's* application-identifier
and embeds no provisioning profile in it, so iOS never runs the extension:
Live Activities start (the Dynamic Island even widens) but draw nothing, and
no widget or control appears in any gallery. Its "9 App IDs Remaining" after
installing an app plus an extension fits: only one App ID was registered.
Sideloadly's own site describes extensions only as something to remove
("Remove individual or all app extensions (PlugIns) before install").

**AltStore provisions each extension separately** — read from its source,
`AltStore/Operations/FetchProvisioningProfilesOperation.swift`:
`for appExtension in app.appExtensions` → `prepareProvisioningProfile(for:
appExtension, …)` → `profiles[appExtension.bundleIdentifier] = profile`, and
`let requiredAppIDs = 1 + application.appExtensions.count`.

**Decision:** install through AltServer for Windows (free). Everything the app
is — banner, lock-screen control, widget — lives in the extension, so an
installer that cannot sign one is not usable for this project.
