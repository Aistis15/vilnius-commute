import AppIntents
import SwiftUI
import WidgetKit

/// The lock-screen button that puts the banner up: one press, no unlocking,
/// no app. The banner is the interface, so this is its front door.
struct StartBannerControl: ControlWidget {
    static let kind = "com.vilniuscommute.app.startbanner"

    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: Self.kind) {
            ControlWidgetButton(action: StartBannerIntent()) {
                Label("Kelionė", systemImage: "bus")
            }
        }
        .displayName("Vilnius · Baneris")
        .description("Parodo kelionės banerį užrakto ekrane.")
    }
}
