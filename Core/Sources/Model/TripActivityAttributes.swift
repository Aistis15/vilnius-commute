import ActivityKit
import Foundation

/// The Live Activity for one trip.
///
/// Phase 1 carries only the `countdown` state from the spec's state table —
/// enough to prove ActivityKit works end to end on a free-signed sideloaded
/// build. The remaining states (walkToStop, onBoard, transfer,
/// walkToDestination, arrived) land in Phase 4, which is also when the
/// `ContentState` grows the fields they need.
public struct TripActivityAttributes: ActivityAttributes, Sendable {

    public typealias ContentState = TripContentState

    /// Where the trip ends, e.g. `ISM`. Fixed for the life of the Activity.
    public let destinationName: String

    public init(destinationName: String) {
        self.destinationName = destinationName
    }
}

/// The part of the Live Activity that changes over time.
public struct TripContentState: Codable, Hashable, Sendable {

    /// When to walk out of the door.
    public var leaveAt: Date
    /// When the trip is planned to arrive.
    public var arriveBy: Date
    /// Route summary, in travel order. Drives the badges.
    public var routes: [RouteRef]

    public init(leaveAt: Date, arriveBy: Date, routes: [RouteRef]) {
        self.leaveAt = leaveAt
        self.arriveBy = arriveBy
        self.routes = routes
    }

    /// A countdown range that is always valid.
    ///
    /// `Text(timerInterval:)` traps when the range is empty or inverted, which
    /// it becomes the moment `leaveAt` passes while the Activity is still on
    /// screen. Clamping the upper bound keeps it drawable at 00:00.
    public func countdownRange(now: Date = .now) -> ClosedRange<Date> {
        let end = max(leaveAt, now)
        return now...end
    }

    public var hasDeparted: Bool { leaveAt <= .now }
}
