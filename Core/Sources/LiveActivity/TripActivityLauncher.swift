import ActivityKit
import Foundation

/// Puts the trip banner up and takes it down.
///
/// Shared by every way of starting one — the in-app button, the lock-screen
/// control, the voice control — so they all put up exactly the same thing
/// and never stack a second banner on top of the first.
///
/// Works with ids rather than `Activity` values because `Activity` is not
/// `Sendable`; see `TripActivityController` for the full reasoning.
public enum TripActivityLauncher {

    /// Starts the banner unless one is already up, and returns its id.
    ///
    /// Phase 1 shows sample data: what is being proven is that one press puts
    /// a banner on the lock screen, not the trip in it.
    @discardableResult
    public static func start(destination: String = TripActivityAttributes.sample.destinationName) throws -> String {
        if let running = Activity<TripActivityAttributes>.activities
            .first(where: { $0.activityState == .active }) {
            return running.id
        }

        let state = TripContentState.sample()
        let activity = try Activity.request(
            attributes: TripActivityAttributes(destinationName: destination),
            content: ActivityContent(
                state: state,
                // Stale a minute after departure: past that the countdown is
                // meaningless and iOS should grey the banner out.
                staleDate: state.leaveAt.addingTimeInterval(60)
            ),
            pushType: nil          // Phase 1 updates locally only.
        )
        return activity.id
    }

    public static func end(id: String) async {
        guard let activity = Activity<TripActivityAttributes>.activities.first(where: { $0.id == id })
        else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
    }
}
