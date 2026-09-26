import SwiftUI
import WidgetKit

/// The widget extension is deliberately thin: every view it draws comes from
/// Core, so the same code is what CI snapshot-tests.
@main
struct VilniusCommuteWidgetsBundle: WidgetBundle {
    var body: some Widget {
        TripLiveActivityWidget()
        VoiceCaptureControl()
        AskWidget()
    }
}
