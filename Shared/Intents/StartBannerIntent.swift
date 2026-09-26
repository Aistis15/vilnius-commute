import AppIntents
import Core

/// Puts the trip banner on the lock screen without opening the app.
///
/// `LiveActivityIntent` is the documented route for exactly this. Apple
/// (developer.apple.com, LiveActivityIntent): "When the system performs the
/// intent, the system launches your app process without opening the app,
/// performs the intent, and starts the Live Activity. For example, people
/// might place a control in Control Center that performs a LiveActivityIntent
/// and starts the activity without opening your app."
///
/// It runs in the APP's process, which is why this file is compiled into both
/// targets: the widget extension needs the type to build the control, the app
/// needs it to perform it.
struct StartBannerIntent: LiveActivityIntent {

    static let title: LocalizedStringResource = "Rodyti kelionės banerį"

    static let description: IntentDescription? = IntentDescription(
        "Parodo kelionės banerį užrakto ekrane."
    )

    static let supportedModes: IntentModes = .background

    func perform() async throws -> some IntentResult {
        try TripActivityLauncher.start()
        return .result()
    }
}
