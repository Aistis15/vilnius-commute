import ActivityKit
import Core
import Foundation
import Observation

/// Starts, updates and ends the trip Live Activity.
///
/// Phase 1 exists to answer one question: does ActivityKit work at all on a
/// build signed with a free Apple ID and installed with Sideloadly? So every
/// failure is captured and surfaced verbatim rather than swallowed — an error
/// string here is the probe result.
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
    private(set) var activityID: String?

    /// The live Activity's current content, re-read after every change.
    ///
    /// Without this the demo screen showed a fixed sample, so "add 5 minutes"
    /// updated the real banner on the lock screen and changed nothing in the
    /// app — indistinguishable from a button that does nothing.
    private(set) var liveState: TripContentState?

    /// Short confirmation of the last action, because an update that only
    /// lands on the lock screen is invisible from inside the app.
    private(set) var lastAction: String?

    /// Whether the system currently permits Live Activities for this app.
    /// Flips to `false` if the user turns them off in Settings.
    var activitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    /// Requests a countdown Live Activity with sample data.
    func start(destination: String = "ISM") {
        guard activityID == nil else { return }

        guard activitiesEnabled else {
            status = .failed("Gyvosios veiklos išjungtos sistemoje.")
            return
        }

        let attributes = TripActivityAttributes(destinationName: destination)
        let state = TripContentState.sample()
        let content = ActivityContent(
            state: state,
            // Go stale a minute after departure: after that the countdown is
            // meaningless and iOS should grey the banner out.
            staleDate: state.leaveAt.addingTimeInterval(60)
        )

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil          // Phase 1 updates locally only.
            )
            activityID = activity.id
            liveState = state
            status = .running
            lastAction = "Paleista \(TimeFormat.clock(.now))"
        } catch {
            // Surfaced in the UI on purpose: this is the go/no-go signal.
            status = .failed(String(describing: error))
        }
    }

    /// Pushes a fresh countdown without tearing the Activity down, to prove
    /// local updates reach the lock screen.
    func bumpCountdown(byMinutes minutes: Int = 5) async {
        guard let activityID else { return }
        await Self.bump(activityID: activityID, byMinutes: minutes)
        refresh()
        lastAction = "Pridėta \(minutes) min · \(TimeFormat.clock(.now))"

    func end() async {
        guard let activityID else { return }
        await Self.end(activityID: activityID)
        self.activityID = nil
        liveState = nil
        status = .idle
        lastAction = "Sustabdyta \(TimeFormat.clock(.now))"
    }

    /// Re-reads the live Activity so the UI reflects what is on the lock
    /// screen rather than what the app last remembered.
    func refresh() {
        guard let activityID else {
            liveState = nil
            return
        }
        liveState = Self.state(of: activityID)
        if Self.find(activityID) == nil {
            // It ended or was dismissed from outside the app.
            self.activityID = nil
            status = .idle
        }
    }

    /// Re-attaches to an Activity that outlived a previous launch.
    func adoptRunningActivity() {
        if activityID == nil, let existing = Self.runningActivityID() {
            activityID = existing
            status = .running
        }
        refresh()
    }

    // MARK: - Nonisolated work
    //
    // These run outside the main actor so the non-Sendable `Activity` never
    // has to cross an isolation boundary. See the note on the type.

    private nonisolated static func find(_ id: String) -> Activity<TripActivityAttributes>? {
        Activity<TripActivityAttributes>.activities.first { $0.id == id }
    }

    private nonisolated static func state(of id: String) -> TripContentState? {
        find(id)?.content.state
    }

    private nonisolated static func runningActivityID() -> String? {
        Activity<TripActivityAttributes>.activities.first?.id
    }

    private nonisolated static func bump(activityID: String, byMinutes minutes: Int) async {
        guard let activity = find(activityID) else { return }

        var state = activity.content.state
        let shift = Double(minutes) * 60
        state.leaveAt = state.leaveAt.addingTimeInterval(shift)
        state.arriveBy = state.arriveBy.addingTimeInterval(shift)

        await activity.update(
            ActivityContent(state: state, staleDate: state.leaveAt.addingTimeInterval(60))
        )
    }

    private nonisolated static func end(activityID: String) async {
        guard let activity = find(activityID) else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
    }
}
