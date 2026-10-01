import ActivityKit
import Foundation

/// Puts a banner up without the page: the lock-screen control, the voice
/// control and the in-app demo.
///
/// Shows the design's sample trip through `TripBanner`, the same path the
/// page's `activity` messages take, so the corner turns its pages and
/// "Taip" ends it exactly as on a real trip. A trip already on screen is
/// left alone rather than stacked on.
///
/// Works with ids rather than `Activity` values because `Activity` is not
/// `Sendable`; see `TripActivityController` for the full reasoning.
public enum TripActivityLauncher {

    /// Starts the sample banner unless one is already up.
    public static func start(destination: String = TripActivityAttributes.sample.destinationName) async throws {
        if TripBanner.shared.isRunning { return }
        try await TripBanner.shared.handle(ActivityMessage(
            op: .start,
            destination: destination,
            palette: .grafitas,
            moments: BannerSamples.demoMoments(),
            page: 0
        ))
    }

    public static func end() async {
        await TripBanner.shared.endTrip()
    }
}

public extension TripActivityAttributes {
    static let sample = TripActivityAttributes(destinationName: "ISM")
}
