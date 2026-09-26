import ActivityKit
import AlarmKit
import AVFoundation
import Core
import CoreLocation
import Foundation
import UIKit
import UserNotifications
import WidgetKit

/// Collects everything the app needs permission or capability for, into one
/// plain-text report that can be copied out and pasted into a chat.
///
/// This exists because the development machine is Windows and the device is
/// the only place these answers live. Reading them off a screenshot one at a
/// time cost several round trips and still missed the thing that mattered —
/// so the app now gathers the lot, including the checks that would have found
/// the widget-extension problem immediately.
struct Diagnostics {

    struct Line {
        let label: String
        let value: String
        /// `nil` when the check is informational rather than pass/fail.
        let ok: Bool?
    }

    struct Section {
        let title: String
        let lines: [Line]
    }

    let sections: [Section]
    let collectedAt: Date

    // MARK: - Plain text

    /// Deliberately plain: no markdown, no emoji beyond the status marks, so
    /// it survives being pasted anywhere.
    var plainText: String {
        var out = "VILNIUS COMMUTE — DIAGNOSTIKA\n"
        out += ISO8601DateFormatter().string(from: collectedAt) + "\n"

        for section in sections {
            out += "\n== \(section.title) ==\n"
            for line in section.lines {
                let mark = switch line.ok {
                case .some(true):  "[OK]  "
                case .some(false): "[!!]  "
                case .none:        "[--]  "
                }
                out += mark + line.label + ": " + line.value + "\n"
            }
        }
        return out
    }

    // MARK: - Collection

    @MainActor
    static func collect() async -> Diagnostics {
        var sections: [Section] = []
        sections.append(device())
        sections.append(await widgetExtension())
        sections.append(provisioning())
        sections.append(liveActivities())
        sections.append(await permissions())
        sections.append(background())
        sections.append(whisper())
        return Diagnostics(sections: sections, collectedAt: .now)
    }

    // MARK: - Device

    private static func device() -> Section {
        var system = utsname()
        uname(&system)
        let model = withUnsafeBytes(of: &system.machine) { raw in
            raw.prefix { $0 != 0 }.map { String(UnicodeScalar(UInt8($0))) }.joined()
        }
        let os = ProcessInfo.processInfo.operatingSystemVersion
        let bundle = Bundle.main

        return Section(title: "Įrenginys", lines: [
            Line(label: "Modelis", value: model, ok: nil),
            Line(label: "iOS",
                 value: "\(os.majorVersion).\(os.minorVersion).\(os.patchVersion)", ok: nil),
            Line(label: "Bundle ID", value: bundle.bundleIdentifier ?? "?", ok: nil),
            Line(label: "Versija",
                 value: "\(bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?")"
                      + " (\(bundle.infoDictionary?["CFBundleVersion"] as? String ?? "?"))",
                 ok: nil),
        ])
    }

    // MARK: - Widget extension
    //
    // The check that matters most. A Live Activity is *drawn* by the widget
    // extension, so if the extension is missing the app can create Activities
    // all day and nothing will ever appear. Splitting "is it on disk" from
    // "is it registered" separates a sideloader stripping it out from a
    // provisioning failure — two problems with completely different fixes.

    private static func widgetExtension() async -> Section {
        var lines: [Line] = []

        // 1. Is the .appex physically inside the installed app?
        let plugIns = Bundle.main.builtInPlugInsURL
        let appexes: [URL] = plugIns.flatMap {
            try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)
        }?.filter { $0.pathExtension == "appex" } ?? []

        lines.append(Line(
            label: "Plėtinys diske",
            value: appexes.isEmpty
                ? "NĖRA — diegiant jis buvo pašalintas"
                : appexes.map(\.lastPathComponent).joined(separator: ", "),
            ok: !appexes.isEmpty
        ))

        for appex in appexes {
            let info = Bundle(url: appex)?.infoDictionary
            let identifier = info?["CFBundleIdentifier"] as? String ?? "?"
            let point = ((info?["NSExtension"] as? [String: Any])?["NSExtensionPointIdentifier"]
                         as? String) ?? "?"
            lines.append(Line(label: "  \(appex.lastPathComponent)",
                              value: "\(identifier) · \(point)", ok: nil))
        }

        // 2. Has iOS actually registered it? These calls reach the system's
        //    widget database, so they answer a different question from the
        //    file check above.
        let widgets: String
        do {
            let infos = try await withCheckedThrowingContinuation { continuation in
                WidgetCenter.shared.getCurrentConfigurations { continuation.resume(with: $0) }
            }
            widgets = infos.isEmpty
                ? "užregistruota, bet nė vieno nepridėta"
                : infos.map(\.kind).joined(separator: ", ")
        } catch {
            widgets = "klaida: \(error.localizedDescription)"
        }
        lines.append(Line(label: "Widget'ai sistemoje", value: widgets, ok: nil))

        do {
            let controls = try await ControlCenter.shared.currentControls()
            lines.append(Line(
                label: "Valdikliai pridėti",
                value: controls.isEmpty ? "nė vieno" : controls.map(\.kind).joined(separator: ", "),
                ok: nil
            ))
        } catch {
            lines.append(Line(label: "Valdikliai pridėti",
                              value: "klaida: \(error.localizedDescription)", ok: nil))
        }

        return Section(title: "Widget'o plėtinys", lines: lines)
    }

    // MARK: - Provisioning
    //
    // The decisive check when the extension is on disk but iOS will not run
    // it. An app extension needs its OWN provisioning profile, whose
    // application-identifier matches its own bundle id. A sideloader that
    // rewrites bundle ids for a free account has to re-sign the extension too
    // — if it only re-signs the app, the extension installs and is then
    // ignored, which looks exactly like a missing extension.

    private static func provisioning() -> Section {
        var lines: [Line] = []

        func describe(_ label: String, bundle: Bundle?, expectedID: String?) {
            guard let bundle else {
                lines.append(Line(label: label, value: "bundle neprieinamas", ok: false))
                return
            }
            guard let url = bundle.url(forResource: "embedded", withExtension: "mobileprovision"),
                  let raw = try? Data(contentsOf: url)
            else {
                lines.append(Line(
                    label: label,
                    value: "NĖRA profilio — nepasirašyta, todėl iOS jo nepaleis",
                    ok: false
                ))
                return
            }

            guard let profile = parseProfile(raw) else {
                lines.append(Line(label: label, value: "profilis yra, bet neperskaitomas", ok: nil))
                return
            }

            let appID = profile.applicationIdentifier ?? "?"
            // The profile id is prefixed with the team id, so compare on the
            // suffix rather than demanding an exact match.
            let matches = expectedID.map { appID.hasSuffix($0) } ?? true
            lines.append(Line(
                label: label,
                value: appID + (matches ? "" : "  ← NESUTAMPA su bundle id"),
                ok: matches
            ))

            if let expiry = profile.expirationDate {
                let days = Int(expiry.timeIntervalSinceNow / 86_400)
                lines.append(Line(
                    label: "  galioja iki",
                    value: "\(ISO8601DateFormatter().string(from: expiry)) (\(days) d.)",
                    ok: days >= 0
                ))
            }
        }

        let appID = Bundle.main.bundleIdentifier
        describe("Programėlės profilis", bundle: .main, expectedID: appID)

        let appexes: [URL] = Bundle.main.builtInPlugInsURL.flatMap {
            try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)
        }?.filter { $0.pathExtension == "appex" } ?? []

        for appex in appexes {
            let bundle = Bundle(url: appex)
            describe("Plėtinio profilis", bundle: bundle,
                     expectedID: bundle?.bundleIdentifier)
        }
        if appexes.isEmpty {
            lines.append(Line(label: "Plėtinio profilis", value: "plėtinio nėra", ok: false))
        }

        return Section(title: "Pasirašymas", lines: lines)
    }

    private struct Profile {
        let applicationIdentifier: String?
        let expirationDate: Date?
    }

    /// A `.mobileprovision` is CMS-wrapped, but the plist inside is plain
    /// text, so it can be sliced out without any crypto.
    private static func parseProfile(_ data: Data) -> Profile? {
        guard let start = data.range(of: Data("<?xml".utf8)),
              let end = data.range(of: Data("</plist>".utf8))
        else { return nil }

        let slice = data[start.lowerBound..<end.upperBound]
        guard let plist = try? PropertyListSerialization.propertyList(
            from: slice, options: [], format: nil
        ) as? [String: Any] else { return nil }

        let entitlements = plist["Entitlements"] as? [String: Any]
        return Profile(
            applicationIdentifier: entitlements?["application-identifier"] as? String,
            expirationDate: plist["ExpirationDate"] as? Date
        )
    }

    // MARK: - Live Activities

    private static func liveActivities() -> Section {
        let info = ActivityAuthorizationInfo()
        let activities = Activity<TripActivityAttributes>.activities

        var lines = [
            Line(label: "Leidžiamos sistemoje",
                 value: info.areActivitiesEnabled ? "taip" : "NE",
                 ok: info.areActivitiesEnabled),
            Line(label: "Dažni atnaujinimai",
                 value: info.frequentPushesEnabled ? "taip" : "ne", ok: nil),
            Line(label: "Šiuo metu veikia", value: "\(activities.count)", ok: nil),
        ]

        for activity in activities {
            lines.append(Line(label: "  \(activity.id.prefix(8))",
                              value: describe(activity.activityState),
                              ok: activity.activityState == .active))
        }
        return Section(title: "Gyvosios veiklos", lines: lines)
    }

    private static func describe(_ state: ActivityState) -> String {
        switch state {
        case .active:    "aktyvi"
        case .dismissed: "atmesta"
        case .ended:     "užbaigta"
        case .stale:     "pasenusi"
        case .pending:   "laukia (iOS dar neparodė)"
        @unknown default: "nežinoma"
        }
    }

    // MARK: - Permissions

    @MainActor
    private static func permissions() async -> Section {
        var lines: [Line] = []

        // Alarms — the capability the whole "get ready" feature rests on.
        let alarm = AlarmManager.shared.authorizationState
        let alarmText: String = switch alarm {
        case .authorized: "suteikta"
        case .denied: "ATMESTA"
        case .notDetermined: "dar neklausta"
        @unknown default: "nežinoma"
        }
        lines.append(Line(label: "AlarmKit", value: alarmText, ok: alarm == .authorized))

        // Location, including accuracy: reduced accuracy would break boarding
        // detection even though the permission itself looks granted.
        let manager = CLLocationManager()
        let status = manager.authorizationStatus
        let statusText: String = switch status {
        case .authorizedAlways: "visada"
        case .authorizedWhenInUse: "tik naudojant"
        case .denied: "ATMESTA"
        case .restricted: "apribota"
        case .notDetermined: "dar neklausta"
        @unknown default: "nežinoma"
        }
        lines.append(Line(label: "Vieta", value: statusText, ok: status == .authorizedAlways))
        lines.append(Line(
            label: "Vietos tikslumas",
            value: manager.accuracyAuthorization == .fullAccuracy ? "tikslus" : "SUMAŽINTAS",
            ok: manager.accuracyAuthorization == .fullAccuracy
        ))

        let mic = AVAudioApplication.shared.recordPermission
        let micText: String = switch mic {
        case .granted: "leista"
        case .denied: "ATMESTA"
        case .undetermined: "dar neklausta"
        @unknown default: "nežinoma"
        }
        lines.append(Line(label: "Mikrofonas", value: micText, ok: mic == .granted))

        // Notifications matter beyond alerts: time-sensitive delivery is what
        // gets a departure warning through a Focus mode.
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let notifyText: String = switch settings.authorizationStatus {
        case .authorized: "leista"
        case .provisional: "laikinai"
        case .denied: "ATMESTA"
        case .notDetermined: "dar neklausta"
        case .ephemeral: "trumpalaikiai"
        @unknown default: "nežinoma"
        }
        lines.append(Line(label: "Pranešimai", value: notifyText,
                          ok: settings.authorizationStatus == .authorized))
        lines.append(Line(label: "  Garsas",
                          value: settings.soundSetting == .enabled ? "taip" : "ne", ok: nil))
        lines.append(Line(label: "  Užrakto ekrane",
                          value: settings.lockScreenSetting == .enabled ? "taip" : "NE",
                          ok: settings.lockScreenSetting == .enabled))
        lines.append(Line(label: "  Svarbūs (time sensitive)",
                          value: settings.timeSensitiveSetting == .enabled ? "taip" : "ne",
                          ok: nil))
        lines.append(Line(label: "  Suvestinėje (atidedami)",
                          value: settings.scheduledDeliverySetting == .enabled ? "TAIP" : "ne",
                          ok: settings.scheduledDeliverySetting != .enabled))

        // App Group: only meaningful in the build that configures one.
        if let group = Bundle.main.object(forInfoDictionaryKey: "VCAppGroupIdentifier") as? String,
           !group.isEmpty {
            let reachable = FileManager.default
                .containerURL(forSecurityApplicationGroupIdentifier: group) != nil
            lines.append(Line(label: "App Group",
                              value: reachable ? group : "NEPASIEKIAMAS (\(group))",
                              ok: reachable))
        } else {
            lines.append(Line(label: "App Group", value: "nenustatytas šiame buildinyje", ok: nil))
        }

        return Section(title: "Leidimai", lines: lines)
    }

    // MARK: - Background

    @MainActor
    private static func background() -> Section {
        let refresh = UIApplication.shared.backgroundRefreshStatus
        let refreshText: String = switch refresh {
        case .available: "įjungta"
        case .denied: "IŠJUNGTA"
        case .restricted: "apribota"
        @unknown default: "nežinoma"
        }
        return Section(title: "Fonas", lines: [
            Line(label: "Background App Refresh", value: refreshText, ok: refresh == .available),
            // Low Power Mode suspends background refresh and throttles
            // location, so a trip that tracks correctly on a full battery can
            // silently stop doing so.
            Line(label: "Mažos galios režimas",
                 value: ProcessInfo.processInfo.isLowPowerModeEnabled ? "ĮJUNGTAS" : "išjungtas",
                 ok: !ProcessInfo.processInfo.isLowPowerModeEnabled),
            Line(label: "Terminis būvis",
                 value: "\(ProcessInfo.processInfo.thermalState.rawValue)", ok: nil),
        ])
    }

    // MARK: - Whisper

    private static func whisper() -> Section {
        var lines: [Line] = []
        let support = try? FileManager.default.url(
            for: .applicationSupportDirectory, in: .userDomainMask,
            appropriateFor: nil, create: false
        )

        for model in WhisperModel.allCases {
            let url = support?.appendingPathComponent(model.rawValue)
            let size = url.flatMap {
                (try? FileManager.default.attributesOfItem(atPath: $0.path)[.size] as? NSNumber)??
                    .int64Value
            }
            lines.append(Line(
                label: model.displayName,
                value: size.map { $0 == model.bytes ? "parsisiųstas" : "sugadintas (\($0) B)" }
                    ?? "nėra",
                ok: size == nil ? nil : size == model.bytes
            ))
        }

        if let failure = UserDefaults.standard.string(forKey: "VCLastVoiceError") {
            lines.append(Line(label: "Paskutinė klaida", value: failure, ok: false))
        }

        if let marker = LockScreenRecordingMarker.read() {
            lines.append(Line(
                label: "Įrašymas iš užrakto",
                value: marker.succeeded
                    ? "pavyko, \(String(format: "%.1f", marker.seconds)) s per „\(marker.writtenTo)“"
                    : "nepavyko: \(marker.message)",
                ok: marker.succeeded
            ))
        } else {
            lines.append(Line(label: "Įrašymas iš užrakto", value: "dar nebandyta", ok: nil))
        }

        return Section(title: "Balsas", lines: lines)
    }
}
