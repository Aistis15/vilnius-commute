import AppIntents
import SwiftUI
import WidgetKit

/// A lock-screen / Control Centre button that runs the recording probe.
///
/// This exists so the Phase 1 go/no-go can be answered by pressing a real
/// button on a real locked phone, rather than by reasoning about what a free
/// Apple ID is allowed to do.
struct VoiceCaptureControl: ControlWidget {
    static let kind = "com.vilniuscommute.app.voicecapture"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: ProbeRecordingIntent()) {
                Label("Kalbėk", systemImage: "mic")
            }
        }
        .displayName("Vilnius · Kalbėk")
        .description("Įrašo kelionės prašymą.")
    }
}
