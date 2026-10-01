import ActivityKit
import Core
import Foundation
import Observation

/// Starts, turns and ends the sample trip banner for the demo screen.
///
/// Every failure is surfaced verbatim rather than swallowed: on a
/// free-signed build an error string here is the probe result.
///
/// ## Why only the id is stored
///
/// `ActivityKit.Activity` is a class that conforms to `Identifiable` and
/// nothing else — in particular it is **not** `Sendable` — while `update` and
/// `end` are `nonisolated async`. Holding one in main-actor state and awaiting
/// a method on it therefore sends main-actor-isolated state out of its
/// isolation domain, which Swift 6 rejects outright.
///
/// Keeping only the `id` (a `String`) and re-finding the activity inside a
/// `nonisolated` function sidesteps that: the value is obtained locally and is
/// visibly unshared, so it may cross. It also happens to be more correct — a
/// Live Activity outlives the app process, so looking it up by id is what
/// survives a relaunch, whereas a stored reference would not.
@MainActor
@Observable
final class TripActivityController {

    enum Status: Equatable {
        case idle
        case running
        case failed(String)
    }

    private(set) var status: Status = .idle

    /// The live Activity's current content, re-read after every change, so
    /// the screen shows what the lock screen shows.
    private(set) var liveState: TripContentState?

    /// Short confirmation of the last action, because an update that only
    /// lands on the lock screen is invisible from inside the app.
    private(set) var lastAction: String?

    /// Whether the system currently permits Live Activities for this app.
    var activitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    func start() async {
        guard activitiesEnabled else {
            status = .failed("Gyvosios veiklos išjungtos sistemoje.")
            return
        }
        do {
            try await TripActivityLauncher.start()
            refresh()
            lastAction = "Paleista \(TimeFormat.clock(.now))"
        } catch {
            status = .failed(String(describing: error))
        }
    }

    /// What the banner's corner does.
    func nextPage() async {
        await TripBanner.shared.nextPage()
        refresh()
        lastAction = "Kitas puslapis · \(TimeFormat.clock(.now))"
    }

    func end() async {
        await TripBanner.shared.endTrip()
        liveState = nil
        status = .idle
        lastAction = "Sustabdyta \(TimeFormat.clock(.now))"
    }

    /// Re-reads the live Activity, which may have changed or ended outside
    /// the app.
    func refresh() {
        liveState = Self.runningState()
        status = liveState == nil ? (status == .running ? .idle : status) : .running
    }

    private nonisolated static func runningState() -> TripContentState? {
        Activity<TripActivityAttributes>.activities
            .first { $0.activityState == .active }?
            .content.state
    }
}
