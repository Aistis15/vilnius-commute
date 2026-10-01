import ActivityKit
import AppIntents
import Core
import SwiftUI
import WidgetKit

/// Lock-screen banner + Dynamic Island for an active trip.
///
/// Every view is Core's; this only wires the taps to the intents.
struct TripLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            TripBannerView(state: context.state, actions: Self.actions)
                // The banner draws its own colourway; the tint is the same
                // base so no system material shows at its edges.
                .activityBackgroundTint(Color(hex: context.state.palette.base))
                .activitySystemActionForegroundColor(Color(hex: context.state.palette.ink))
                .widgetURL(Self.tripURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TripIslandExpandedLeading(state: context.state)
                        .padding(.leading, 8)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TripIslandExpandedTrailing(state: context.state)
                        .padding(.trailing, 8)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TripIslandExpandedBottom(state: context.state, actions: Self.actions)
                        .padding(.horizontal, 8)
                }
            } compactLeading: {
                TripIslandCompactLeading(state: context.state)
            } compactTrailing: {
                TripIslandCompactTrailing(state: context.state)
            } minimal: {
                TripIslandMinimal(state: context.state)
            }
            .widgetURL(Self.tripURL)
        }
    }

    // A tap anywhere but a button opens the trip in the app.
    // Force-unwrapped literals: both are constant, valid URLs.
    private static let tripURL = URL(string: "vilniuscommute://trip")!
    private static let replanURL = URL(string: "vilniuscommute://replan")!

    private static var actions: BannerActions {
        BannerActions(
            page: { label in
                AnyView(Button(intent: NextBannerPageIntent()) { label }.buttonStyle(.plain))
            },
            button: { button, label in
                switch button.action {
                case "trip-done":
                    AnyView(Button(intent: EndTripIntent()) { label }.buttonStyle(.plain))
                case "trip-snooze":
                    AnyView(Button(intent: SnoozeTripIntent()) { label }.buttonStyle(.plain))
                case "replan":
                    // Replanning needs the app, so it is a link that opens it.
                    AnyView(Link(destination: replanURL) { label })
                default:
                    AnyView(Link(destination: tripURL) { label })
                }
            }
        )
    }
}
