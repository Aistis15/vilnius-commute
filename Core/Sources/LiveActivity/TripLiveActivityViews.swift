import SwiftUI
import WidgetKit

// The Live Activity presentations, as plain SwiftUI views.
//
// They live in Core rather than in the widget extension so that CI snapshot
// tests can render them: a unit-test bundle cannot import an app extension.
// The extension assembles them into an ActivityConfiguration and nothing more.

// MARK: - Lock screen / banner

public struct TripLockScreenView: View {
    private let attributes: TripActivityAttributes
    private let state: TripContentState

    public init(attributes: TripActivityAttributes, state: TripContentState) {
        self.attributes = attributes
        self.state = state
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Išeik")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text(TimeFormat.clock(state.leaveAt))
                        .font(.system(.largeTitle, weight: .semibold))
                        .monospacedDigit()
                        .contentTransition(.numericText())
                }

                Spacer(minLength: 8)

                VStack(alignment: .trailing, spacing: 1) {
                    Text("Liko")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    CountdownWithUnit(state: state, font: .largeTitle)
                }
            }

            HStack(spacing: 8) {
                RouteSummary(routes: state.routes, size: .small)
                Spacer(minLength: 8)
                Text("\(attributes.destinationName) \(TimeFormat.clock(state.arriveBy))")
                    .font(.subheadline)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

/// A live countdown that cannot be mistaken for a clock time.
///
/// The problem this solves: the banner shows "Iseik 13:43" next to a bare
/// "12:04". Two numbers, same size, same monospaced face, one a wall clock and
/// one a duration — nothing distinguishes them, so the countdown reads as a
/// time of day.
///
/// The format itself is forced. Only `Text(timerInterval:)` keeps ticking once
/// the app is backgrounded; a computed "12 min" string would freeze at
/// whatever it said when the app was last awake, which is worse than
/// ambiguous — it would be quietly wrong. `.relative` is too verbose for the
/// banner ("2 hours, 23 minutes") and `.timer` has the same mm:ss shape.
///
/// So the fix is the unit, not the format: a trailing `min` marks it as a
/// duration, which is also how the spec's own copy reads ("Liko 12 min").
public struct CountdownWithUnit: View {
    private let state: TripContentState
    private let font: Font.TextStyle

    public init(state: TripContentState, font: Font.TextStyle = .largeTitle) {
        self.state = state
        self.font = font
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            // `fixedSize` rather than a `minWidth` frame. A fixed minimum
            // starved this at default type and the timer truncated to "12:…",
            // while the same layout was fine at XXL — `Text(timerInterval:)`
            // does not report a dependable ideal width, so it has to be
            // allowed to size itself and given priority over the unit label.
            Text(timerInterval: state.countdownRange(),
                 countsDown: true,
                 showsHours: false)
                .font(.system(font, weight: .semibold))
                .monospacedDigit()
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .layoutPriority(1)

            Text("min")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Liko \(TimeFormat.minutesUntil(state.leaveAt)) min")
    }
}

// MARK: - Route summary

/// Badges in travel order, separated by a transfer chevron.
public struct RouteSummary: View {
    private let routes: [RouteRef]
    private let size: RouteBadge.Size

    public init(routes: [RouteRef], size: RouteBadge.Size = .regular) {
        self.routes = routes
        self.size = size
    }

    public var body: some View {
        HStack(spacing: 4) {
            ForEach(Array(routes.enumerated()), id: \.offset) { index, route in
                if index > 0 {
                    Image(systemName: "chevron.compact.right")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                RouteBadge(route, size: size)
            }
        }
    }
}

// MARK: - Dynamic Island regions

public struct TripIslandCompactLeading: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        if let first = state.routes.first {
            RouteBadge(first, size: .small)
        } else {
            Image(systemName: "figure.walk")
        }
    }
}

public struct TripIslandCompactTrailing: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        Text(timerInterval: state.countdownRange(), countsDown: true, showsHours: false)
            .font(.caption)
            .monospacedDigit()
            .multilineTextAlignment(.trailing)
            .frame(maxWidth: 52)
    }
}

public struct TripIslandMinimal: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        Text(timerInterval: state.countdownRange(), countsDown: true, showsHours: false)
            .font(.caption2)
            .monospacedDigit()
            .frame(maxWidth: 44)
    }
}

public struct TripIslandExpandedLeading: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Išeik")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text(TimeFormat.clock(state.leaveAt))
                .font(.system(.title2, weight: .semibold))
                .monospacedDigit()
        }
    }
}

public struct TripIslandExpandedTrailing: View {
    private let attributes: TripActivityAttributes
    private let state: TripContentState

    public init(attributes: TripActivityAttributes, state: TripContentState) {
        self.attributes = attributes
        self.state = state
    }

    public var body: some View {
        VStack(alignment: .trailing, spacing: 2) {
            Text(attributes.destinationName)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .lineLimit(1)
            Text(TimeFormat.clock(state.arriveBy))
                .font(.system(.title2, weight: .semibold))
                .monospacedDigit()
        }
    }
}

public struct TripIslandExpandedBottom: View {
    private let state: TripContentState
    public init(state: TripContentState) { self.state = state }

    public var body: some View {
        HStack(spacing: 8) {
            RouteSummary(routes: state.routes, size: .regular)
            Spacer(minLength: 8)
            // Same reasoning as the banner: the arrival clock time sits
            // directly above this, so the countdown needs its unit.
            CountdownWithUnit(state: state, font: .title3)
        }
        .padding(.top, 4)
    }
}

// MARK: - Sample data

public extension TripContentState {
    /// Fixed sample used by previews and CI snapshots.
    ///
    /// Dates are relative to `now` so the countdown is non-trivial, but the
    /// snapshot harness pins `now` to keep renders byte-comparable.
    static func sample(now: Date = .now) -> TripContentState {
        TripContentState(
            leaveAt: now.addingTimeInterval(12 * 60),
            arriveBy: now.addingTimeInterval(36 * 60),
            routes: [.previewExpress, .previewTrolley]
        )
    }

    static func sampleSingleLeg(now: Date = .now) -> TripContentState {
        TripContentState(
            leaveAt: now.addingTimeInterval(5 * 60),
            arriveBy: now.addingTimeInterval(24 * 60),
            routes: [.previewBus]
        )
    }
}

public extension TripActivityAttributes {
    static let sample = TripActivityAttributes(destinationName: "ISM")
}
