import ActivityKit
import AlarmKit
import AVFoundation
import Core
import CoreLocation
import Foundation
import Observation

/// One capability, and what actually happened when we asked for it.
struct ProbeResult: Identifiable, Sendable {
    enum Outcome: Sendable {
        case pass
        case fail
        case needsUser      // available, but not granted yet
        case unknown        // cannot be determined from inside the app
    }

    let id: String
    let title: String
    let outcome: Outcome
    let detail: String
}

/// Runs the free-Apple-ID capability probe from section 1 of the spec.
///
/// Every result is measured on the device the app is running on. Nothing is
/// inferred: where a capability cannot be determined from inside the app, it
/// reports `.unknown` and says what would settle it, rather than guessing.
@MainActor
@Observable
final class CapabilityProbe {

    private(set) var results: [ProbeResult] = []
    private(set) var lastRun: Date?

    private let locationManager = CLLocationManager()

    /// The App Group this build was compiled against, injected via Info.plist
    /// so the entitlement and the code cannot drift apart.
    var configuredAppGroup: String? {
        let value = Bundle.main.object(forInfoDictionaryKey: "VCAppGroupIdentifier") as? String
        return (value?.isEmpty == false) ? value : nil
    }

    func runAll() async {
        results = [
            probeAppGroup(),
            probeLiveActivities(),
            probeAlarmKit(),
            probeBackgroundLocation(),
            probeLockScreenAudioIntent(),
        ]
        lastRun = .now
    }

    // MARK: - 1. App Groups

    /// A free Apple ID is widely reported not to be able to provision an App
    /// Group. The entitlement is therefore kept out of the default build — an
    /// unprovisionable entitlement makes the install fail outright — and
    /// shipped as a second IPA instead, so this can be tested without
    /// bricking the main one.
    ///
    /// A non-nil container URL is not proof on its own: the path can come back
    /// and still not be writable. So this writes, reads back and deletes.
    private func probeAppGroup() -> ProbeResult {
        guard let group = configuredAppGroup else {
            return ProbeResult(
                id: "appgroup",
                title: "App Groups",
                outcome: .unknown,
                detail: "Šiame buildinyje App Group nenustatytas. Tam yra atskiras IPA — žr. docs/capability-probe.md."
            )
        }

        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: group) else {
            return ProbeResult(
                id: "appgroup",
                title: "App Groups",
                outcome: .fail,
                detail: "Nėra konteinerio „\(group)“. Teisė nesuteikta."
            )
        }

        let probeFile = container.appendingPathComponent("probe.txt")
        let payload = Data("ok".utf8)
        do {
            try payload.write(to: probeFile, options: .atomic)
            let readBack = try Data(contentsOf: probeFile)
            try? FileManager.default.removeItem(at: probeFile)
            guard readBack == payload else {
                return ProbeResult(
                    id: "appgroup", title: "App Groups", outcome: .fail,
                    detail: "Įrašyta, bet nuskaityta kitaip. Konteineris nepatikimas."
                )
            }
            return ProbeResult(
                id: "appgroup", title: "App Groups", outcome: .pass,
                detail: "Rašymas ir skaitymas veikia: \(group)"
            )
        } catch {
            return ProbeResult(
                id: "appgroup", title: "App Groups", outcome: .fail,
                detail: "Konteineris yra, bet neįrašoma: \(error.localizedDescription)"
            )
        }
    }

    // MARK: - 2. Live Activities

    private func probeLiveActivities() -> ProbeResult {
        let info = ActivityAuthorizationInfo()
        let live = Activity<TripActivityAttributes>.activities.count

        guard info.areActivitiesEnabled else {
            return ProbeResult(
                id: "liveactivity",
                title: "Gyvosios veiklos",
                outcome: .needsUser,
                detail: "Išjungta. Nustatymai → Vilnius → Gyvosios veiklos."
            )
        }

        let suffix = live > 0 ? " Šiuo metu veikia: \(live)." : ""
        return ProbeResult(
            id: "liveactivity",
            title: "Gyvosios veiklos",
            outcome: .pass,
            detail: "Sistema leidžia.\(suffix) Paleisk skiltyje „Gyvoji veikla“, kad pamatytum tikrą banerį."
        )
    }

    // MARK: - 3. AlarmKit

    /// AlarmKit is iOS 26.0+ and requires `NSAlarmKitUsageDescription`, which
    /// this target sets. Both verified on developer.apple.com.
    private func probeAlarmKit() -> ProbeResult {
        switch AlarmManager.shared.authorizationState {
        case .authorized:
            ProbeResult(
                id: "alarmkit", title: "AlarmKit", outcome: .pass,
                detail: "Leidimas suteiktas. Žadintuvas turi skambėti ir per tylųjį režimą."
            )
        case .denied:
            ProbeResult(
                id: "alarmkit", title: "AlarmKit", outcome: .fail,
                detail: "Atmesta. Nustatymai → Vilnius."
            )
        case .notDetermined:
            ProbeResult(
                id: "alarmkit", title: "AlarmKit", outcome: .needsUser,
                detail: "Dar neklausta. Paspausk „Prašyti leidimo“."
            )
        @unknown default:
            ProbeResult(
                id: "alarmkit", title: "AlarmKit", outcome: .unknown,
                detail: "Nežinoma būsena."
            )
        }
    }

    func requestAlarmAuthorization() async {
        _ = try? await AlarmManager.shared.requestAuthorization()
        await runAll()
    }

    // MARK: - 4. Background location

    private func probeBackgroundLocation() -> ProbeResult {
        switch locationManager.authorizationStatus {
        case .authorizedAlways:
            ProbeResult(
                id: "bglocation", title: "Vieta fone", outcome: .pass,
                detail: "„Visada“ suteikta. Įlaipinimą fone sekti įmanoma."
            )
        case .authorizedWhenInUse:
            ProbeResult(
                id: "bglocation", title: "Vieta fone", outcome: .needsUser,
                detail: "Tik „naudojant programėlę“. Fone sekti nepavyks — reikia „Visada“."
            )
        case .denied, .restricted:
            ProbeResult(
                id: "bglocation", title: "Vieta fone", outcome: .fail,
                detail: "Vietos prieiga uždrausta."
            )
        case .notDetermined:
            ProbeResult(
                id: "bglocation", title: "Vieta fone", outcome: .needsUser,
                detail: "Dar neklausta. Paspausk „Prašyti leidimo“."
            )
        @unknown default:
            ProbeResult(
                id: "bglocation", title: "Vieta fone", outcome: .unknown,
                detail: "Nežinoma būsena."
            )
        }
    }

    func requestLocationAuthorization() {
        // "When in use" has to be granted before "Always" can be escalated.
        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
        } else {
            locationManager.requestAlwaysAuthorization()
        }
    }

    // MARK: - 5. AudioRecordingIntent from the lock screen

    /// `AudioRecordingIntent` is a real App Intents protocol (iOS 18+,
    /// verified on developer.apple.com). What cannot be answered from inside
    /// the app is whether a *free-signed* build may run one from a lock-screen
    /// Control while the device is locked — that needs a real tap on a real
    /// locked phone.
    ///
    /// The Control writes a marker when it runs, so this reports the last
    /// actual invocation instead of speculating.
    private func probeLockScreenAudioIntent() -> ProbeResult {
        let mic = micPrefix(AVAudioApplication.shared.recordPermission)

        guard let marker = LockScreenRecordingMarker.read() else {
            return ProbeResult(
                id: "audiointent",
                title: "Įrašymas iš užrakto ekrano",
                outcome: .unknown,
                detail: mic + "Dar nebandyta. Įdėk valdiklį į užrakto ekraną ir paspausk jį, kai telefonas užrakintas."
            )
        }

        let when = TimeFormat.clock(marker.date)
        if marker.succeeded {
            return ProbeResult(
                id: "audiointent",
                title: "Įrašymas iš užrakto ekrano",
                outcome: .pass,
                detail: mic + "Pavyko \(when): \(String(format: "%.1f", marker.seconds)) s, per „\(marker.writtenTo)“."
            )
        }
        return ProbeResult(
            id: "audiointent",
            title: "Įrašymas iš užrakto ekrano",
            outcome: .fail,
            detail: mic + "Nepavyko \(when): \(marker.message)"
        )
    }

    private func micPrefix(_ permission: AVAudioApplication.recordPermission) -> String {
        switch permission {
        case .granted:      "Mikrofonas: leista. "
        case .denied:       "Mikrofonas: uždrausta. "
        case .undetermined: "Mikrofonas: dar neklausta. "
        @unknown default:   "Mikrofonas: nežinoma. "
        }
    }

    func clearLockScreenMarker() async {
        LockScreenRecordingMarker.clear()
        await runAll()
    }
}
