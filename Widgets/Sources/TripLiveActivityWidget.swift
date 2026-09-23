import ActivityKit
import Core
import SwiftUI
import WidgetKit

/// Lock-screen banner + Dynamic Island for an active trip.
///
/// Phase 1 implements the `countdown` state only.
struct TripLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TripActivityAttributes.self) { context in
            TripLockScreenView(attributes: context.attributes, state: context.state)
                // nil keeps the system's default material. The design rule is
                // that transit colour is the only saturated colour in the app,
                // so the banner itself stays monochrome.
                .activityBackgroundTint(nil)
                .activitySystemActionForegroundColor(nil)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TripIslandExpandedLeading(state: context.state)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TripIslandExpandedTrailing(attributes: context.attributes, state: context.state)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TripIslandExpandedBottom(state: context.state)
                }
            } compactLeading: {
                TripIslandCompactLeading(state: context.state)
            } compactTrailing: {
                TripIslandCompactTrailing(state: context.state)
            } minimal: {
                TripIslandMinimal(state: context.state)
            }
        }
    }
}
