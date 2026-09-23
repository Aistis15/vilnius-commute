# Vilnius Commute

A personal iOS app for getting across Vilnius by public transport: tell it when
you need to be somewhere, and it tells you when to leave, wakes you with an
alarm, and walks you there from the lock screen.

UI is in Lithuanian. Code and comments are in English.

## Status

**Phase 1 — go/no-go. Build green, awaiting device results.**

App shell, widget extension, one countdown Live Activity, a capability probe,
and a Lithuanian speech-to-text test screen. CI is green end to end: unit
tests, snapshot renders, and two unsigned `.ipa`s.

The probe results are **not collected yet** — they need a physical iPhone. See
[docs/capability-probe.md](docs/capability-probe.md).

## Constraints this is built under

| | |
|---|---|
| Target | iPhone, iOS 26.0 |
| Development machine | Windows. No Mac, ever. |
| Build | GitHub Actions macOS runner → unsigned `.ipa` |
| Install | Sideloadly + free Apple ID, re-signed every 7 days |
| Budget | €0 — no paid APIs, no Apple Developer Program |
| Dependencies | whisper.cpp only |

Nothing is built locally. The project file itself is generated in CI, because a
Windows machine cannot open or repair an `.xcodeproj`.

## Layout

```
App/        SwiftUI app: shell, capability probe, whisper test screen
Widgets/    Widget extension: Live Activity + lock-screen Control (thin shell)
Core/       Shared: model, design system, Live Activity views. Unit-tested.
Tests/      CoreTests (logic) + SnapshotTests (renders PNGs for review)
Tools/      whisper xcframework build, CI packaging
docs/       decisions, capability probe, data formats
design/     reference screenshots (Phase 2)
```

Live Activity **views** live in `Core/`, not in `Widgets/`, so CI can render
them — a unit-test bundle cannot import an app extension. See
[docs/decisions.md](docs/decisions.md) D2.

## Building

CI does everything (`.github/workflows/build.yml`):

1. Build `whisper.xcframework` from source, pinned to v1.9.4 and cached.
2. `xcodegen generate` from `project.yml`.
3. Unit tests, then snapshot renders.
4. Two unsigned `.ipa`s — see [docs/capability-probe.md](docs/capability-probe.md)
   for why there are two.

Artifacts: `ipa` and `snapshots`.

## Installing

Download the `ipa` artifact, then sideload `VilniusCommute-default.ipa` with
Sideloadly and a free Apple ID. It expires after 7 days and needs re-signing.

Do not start with `VilniusCommute-appgroups.ipa` — it exists only to test
whether a free account can provision an App Group, and may fail to install by
design.

## Data

Schedules come from the Vilnius GTFS feed at
`https://www.stops.lt/vilnius/vilnius/gtfs.zip`, and live vehicle positions
from `https://www.stops.lt/vilnius/gps_full.txt`. Neither is consumed yet —
that is Phase 2, and the real formats get documented in
[docs/data-formats.md](docs/data-formats.md) before any parser is written.

No personal data — home address, saved places, Apple ID — belongs in this
repository.
