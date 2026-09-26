# Capability probe — free Apple ID, sideloaded build

Phase 1 exists to answer one question before anything is built on top of it:
**which of the capabilities this app depends on actually survive a build signed
with a free Apple ID and installed with Sideloadly?**

Everything later in the spec — the alarm, the lock-screen banner, boarding
detection, voice from the lock screen — depends on the answers.

## Status of this document

| | |
|---|---|
| Probe app | Built and green in CI |
| Last green run | [35872596608](https://github.com/Aistis15/vilnius-commute/actions/runs/35872596608) |
| Probe results | **Collected 2026-09-26** — see below |

The results cannot be produced from a Windows machine or from CI. They require
installing the `.ipa` on a physical iPhone with a free Apple ID and reading the
**Patikra** screen. The table at the bottom is deliberately empty rather than
filled with plausible-looking guesses.

### What the simulator already showed

The probe runs on launch, so the CI snapshot of the Patikra screen is itself a
result — for the simulator, which is *not* a free-signed device and therefore
answers a different question:

| Capability | In the simulator | Means |
|---|---|---|
| App Groups | "App Group nenustatytas" | Correct: the default build has none configured |
| Live Activities | "Sistema leidžia" | ActivityKit is available and permitted |
| AlarmKit | "Dar neklausta" | API present and callable; authorization not yet requested |
| Background location | "Dar neklausta" | Same |
| Lock-screen recording | "Dar nebandyta" | Needs a real locked device |

This proves the probe code runs and reports correctly. It says nothing about
what a free Apple ID permits — only the device can.

## What was verified without a device

These were checked against primary sources, not assumed:

| Claim | How it was checked | Result |
|---|---|---|
| A macOS runner can build for iOS 26 | `actions/runner-images` macOS 26 image manifest | Yes — Xcode 26.0.1–26.6, iOS SDK 26.0–26.5 |
| AlarmKit exists and is usable at iOS 26 | developer.apple.com AlarmKit docs | Yes — iOS 26.0+ |
| AlarmKit's required Info.plist key | AlarmKit "Scheduling an alarm" article | `NSAlarmKitUsageDescription`, now set |
| AlarmKit authorization API | `AlarmManager` symbol list | `shared`, `authorizationState`, `requestAuthorization() async throws` |
| `AudioRecordingIntent` is real | developer.apple.com App Intents docs | Yes — protocol, iOS 18.0+, refines `SystemIntent` |
| Controls API for a lock-screen button | WidgetKit docs | `StaticControlConfiguration(kind:content:)`, `ControlWidgetButton(action:label:)`, iOS 18.0+ |
| whisper.cpp supports Lithuanian | `src/whisper.cpp` language table at v1.9.4 | Yes — `{ "lt", { 34, "lithuanian" } }` |
| whisper.cpp can be linked | Repo contents at v1.9.4 | No Swift package, no release binaries — must build `build-xcframework.sh` from source |
| visionOS SDK on the runner | macOS 26 image manifest | **Absent** — upstream's script builds visionOS and would fail, so it is patched to iOS only |

## Finding: an unsigned `.ipa` carries no entitlements

This matters more than it first looks, so it is written down rather than left
implicit.

`xcodebuild` only embeds entitlements when it **signs** a binary. This project
never signs — CI has no certificate, and the whole point is that Sideloadly
re-signs with a free Apple ID afterwards. So the `.ipa` produced here contains
no entitlements regardless of what the `.entitlements` files say, and the final
entitlement set is whatever Sideloadly applies.

Most of what this app needs is not gated on entitlements at all:

| Capability | Gated by | Survives an unsigned build |
|---|---|---|
| Live Activities | `NSSupportsLiveActivities` (Info.plist) | Yes |
| AlarmKit | `NSAlarmKitUsageDescription` (Info.plist) | Yes |
| Background location | `UIBackgroundModes` (Info.plist) | Yes |
| Microphone | `NSMicrophoneUsageDescription` (Info.plist) | Yes |
| **App Groups** | `com.apple.security.application-groups` (entitlement) | **No** |

App Groups is the one real entitlement in the list, and it is also the one a
free Apple ID is least likely to be able to provision. Hence the two builds.

## The two `.ipa` files

CI produces both:

| File | `VCAppGroupIdentifier` | Use |
|---|---|---|
| `VilniusCommute-default.ipa` | empty | Install this one first. Nothing can fail to provision. |
| `VilniusCommute-appgroups.ipa` | `group.com.vilniuscommute.app` | Only for testing App Groups, with Sideloadly configured to add that group. |

Install `default` first and confirm the app runs. An entitlement a free account
cannot provision makes the install fail outright, so keeping the risky one
separate means a failure there cannot take the whole go/no-go down with it.

## How to run the probe

1. Download the `ipa` artifact from the Actions run.
2. Sideload `VilniusCommute-default.ipa` with Sideloadly and your free Apple ID.
3. Open the app → **Patikra**.
4. Tap **Prašyti leidimo** for alarms and for location, and allow **Always** for
   location when iOS offers it.
5. Open **Gyvoji veikla** → **Paleisti**, then lock the phone and look at the
   lock screen and the Dynamic Island.
6. For the lock-screen recording test: add the **Vilnius · Kalbėk** control to
   the lock screen or Control Centre, lock the phone, press it, then reopen
   **Patikra**.
7. Report what each row says.

For App Groups, repeat with `VilniusCommute-appgroups.ipa` and Sideloadly set
to add `group.com.vilniuscommute.app`.

## Results

Collected 2026-09-26 on a physical iPhone running iOS 26, sideloaded with
Sideloadly and a free Apple ID.

### Verdict: GO

The three capabilities the rest of the spec depends on all work on a free
Apple ID. Phases 3 and 4 can be built as designed.

| Capability | Result | Evidence |
|---|---|---|
| **Live Activities** | ✅ **Works** | Probe reported "Sistema leidžia. Šiuo metu veikia: 1" — `Activity.request` succeeded and ActivityKit held a live instance |
| **AlarmKit** | ✅ **Works** | Authorization granted. A free Apple ID *can* schedule alarms that ring through silent mode |
| **Background location** | ✅ **Works** | "Always" granted, so boarding detection in the background is possible |
| Microphone | ✅ Granted | |
| App Groups | ⏭️ Not tested | Deliberately skipped — optional, and there is a fallback. See D5 |
| `AudioRecordingIntent` from the lock screen | ⏳ Pending | Control not yet pressed on a locked device |

The most consequential of these is AlarmKit. It was the biggest single risk in
the whole plan: without it there is no way to wake someone through silent mode,
and the "get ready" alarm is the feature the app exists for.

### Display note, not a capability limit

The banner did not appear on the lock screen on first attempt, but the probe
showed an Activity *was* running. That separates the two possible causes: the
app created it successfully and iOS declined to display it, which is a Settings
matter (`Settings → <app> → Live Activities`, and `Settings → Face ID &
Passcode → Allow Access When Locked → Live Activities`) rather than anything
free signing prevents.

### Whisper, Lithuanian

| Model | Result |
|---|---|
| `base` (57 MB) | Inaccurate |
| `small` (181 MB) | Better, but still wrong enough to be unusable |

Not yet diagnosed. Two candidate causes, and they need different fixes, so the
transcript text is required before changing anything:

1. **The model genuinely cannot do short Lithuanian utterances**, particularly
   proper nouns like ISM and OZAS. Then Phase 5 needs a different approach —
   a constrained grammar, or `medium`, or rethinking voice entry.
2. **The audio pipeline is feeding whisper poor input.** `AVAudioSession` mode
   `.measurement` is a live suspect: it disables input gain processing, which
   can leave the recording too quiet for whisper to work with.

Distinguishing them is cheap: plausible-but-wrong Lithuanian words mean the
audio is fine and the model is weak; silence markers, gibberish or another
language suggest the audio is wrong.

## Known unknown, carried into Phase 5

Whether transcription can **finish while the phone stays locked** is not
answered by this probe. The Control records audio; it does not transcribe.
Running whisper from an App Intent while locked is a separate question, and the
spec's stated fallback — briefly opening the app — stands until it is measured.
