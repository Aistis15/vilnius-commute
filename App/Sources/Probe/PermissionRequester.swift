import AlarmKit
import AVFoundation
import CoreLocation
import Foundation
import UserNotifications

/// Asks for every permission the app will ever need, in one pass.
///
/// Each of these is normally requested at the moment the feature needs it,
/// which is the right behaviour for a shipping app. For the capability probe
/// it is the wrong behaviour: it scatters the prompts across four screens and
/// makes "did you grant everything?" impossible to answer in one go.
///
/// Order matters. Location has to be asked for in two steps — iOS will not
/// offer "Always" until "When In Use" has been granted, and asking for Always
/// first silently gets you the lesser one.
@MainActor
struct PermissionRequester {

    private let locationManager = CLLocationManager()

    /// Requests everything, in sequence, waiting for each prompt to resolve.
    /// Returns a short human-readable trace of what happened.
    func requestAll() async -> [String] {
        var trace: [String] = []

        // Notifications. `.timeSensitive` is requested alongside the usual
        // options because a departure warning is exactly the case that has to
        // break through a Focus mode.
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(
                options: [.alert, .sound, .badge, .timeSensitive]
            )
            trace.append("Pranešimai: \(granted ? "leista" : "atmesta")")
        } catch {
            trace.append("Pranešimai: klaida — \(error.localizedDescription)")
        }

        let mic = await AVAudioApplication.requestRecordPermission()
        trace.append("Mikrofonas: \(mic ? "leista" : "atmesta")")

        do {
            let state = try await AlarmManager.shared.requestAuthorization()
            trace.append("Žadintuvai: \(state == .authorized ? "leista" : "atmesta")")
        } catch {
            trace.append("Žadintuvai: klaida — \(error.localizedDescription)")
        }

        // Step one. The prompt is modal, so give it room to resolve before
        // asking for the escalation — otherwise the second request is made
        // while the first is still on screen and is dropped.
        if locationManager.authorizationStatus == .notDetermined {
            locationManager.requestWhenInUseAuthorization()
            trace.append("Vieta: paprašyta „naudojant programėlę“")
            await waitForLocationDecision()
        }

        // Step two: escalate to Always, which is what background boarding
        // detection needs.
        if locationManager.authorizationStatus == .authorizedWhenInUse {
            locationManager.requestAlwaysAuthorization()
            trace.append("Vieta: paprašyta „visada“")
            await waitForLocationDecision()
        }

        trace.append("Vieta dabar: \(describe(locationManager.authorizationStatus))")
        return trace
    }

    /// Polls rather than using the delegate.
    ///
    /// `CLLocationManagerDelegate` is not main-actor isolated, so wiring it up
    /// under Swift 6 costs more than it earns for a one-shot probe. Capped so
    /// a dismissed prompt cannot hang the screen.
    private func waitForLocationDecision() async {
        let before = locationManager.authorizationStatus
        for _ in 0..<40 {                       // ~10 seconds
            try? await Task.sleep(for: .milliseconds(250))
            if locationManager.authorizationStatus != before { return }
        }
    }

    private func describe(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .authorizedAlways:    "visada"
        case .authorizedWhenInUse: "tik naudojant"
        case .denied:              "atmesta"
        case .restricted:          "apribota"
        case .notDetermined:       "dar neklausta"
        @unknown default:          "nežinoma"
        }
    }
}
