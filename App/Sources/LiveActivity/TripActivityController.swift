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
@MainActor
@Observable
final class TripActivityController {

    enum Status: Equatable {
        case idle
        case running
        case failed(String)
    }

    private(set) var status: Status = .idle
    private var activity: Activity<TripActivityAttributes>?

    /// Whether the system currently permits Live Activities for this app.
    /// Flips to `false` if the user turns them off in Settings.
    var activitiesEnabled: Bool {
        ActivityAuthorizationInfo().areActivitiesEnabled
    }

    var activityID: String? { activity?.id }

    /// Requests a countdown Live Activity with sample data.
    func start(destination: String = "ISM") {
        guard activity == nil else { return }

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
            activity = try Activity.request(
                attributes: attributes,
                content: content,
                pushType: nil          // Phase 1 updates locally only.
            )
            status = .running
        } catch {
            // Surfaced in the UI on purpose: this is the go/no-go signal.
            status = .failed(String(describing: error))
        }
    }

    /// Pushes a fresh countdown without tearing the Activity down, to prove
    /// local updates reach the lock screen.
    func bumpCountdown(byMinutes minutes: Int = 5) async {
        guard let activity else { return }
        var state = activity.content.state
        state.leaveAt = state.leaveAt.addingTimeInterval(Double(minutes) * 60)
        state.arriveBy = state.arriveBy.addingTimeInterval(Double(minutes) * 60)
        await activity.update(
            ActivityContent(state: state, staleDate: state.leaveAt.addingTimeInterval(60))
        )
    }

    func end() async {
        guard let activity else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
        self.activity = nil
        status = .idle
    }
}
