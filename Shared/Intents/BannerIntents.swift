import AppIntents
import Core

// The buttons on the trip banner.
//
// A Live Activity takes taps on buttons only, and a `Button(intent:)` there
// performs a `LiveActivityIntent` in the APP's process without opening it
// (developer.apple.com, LiveActivityIntent). That is why these files are
// compiled into both targets: the extension draws the buttons, the app runs
// them, and the moments the intents read live in the app's container.

/// The banner's corner: shows the next of the current moment's pages.
struct NextBannerPageIntent: LiveActivityIntent {

    static let title: LocalizedStringResource = "Kitas banerio puslapis"

    static let description: IntentDescription? = IntentDescription(
        "Parodo kitą kelionės banerio puslapį."
    )

    static let supportedModes: IntentModes = .background

    func perform() async throws -> some IntentResult {
        await TripBanner.shared.nextPage()
        if let index = TripMoments.load()?.pageIndex {
            BannerActionQueue.post("page:\(index)")
        }
        return .result()
    }
}

/// "Taip" on "Ar baigėte kelionę?": the trip is over.
struct EndTripIntent: LiveActivityIntent {

    static let title: LocalizedStringResource = "Baigti kelionę"

    static let description: IntentDescription? = IntentDescription(
        "Nuima kelionės banerį."
    )

    static let supportedModes: IntentModes = .background

    func perform() async throws -> some IntentResult {
        await TripBanner.shared.endTrip()
        BannerActionQueue.post("trip-done")
        return .result()
    }
}

/// "Dar ne": the banner moves on to the trip's next moment.
struct SnoozeTripIntent: LiveActivityIntent {

    static let title: LocalizedStringResource = "Dar ne"

    static let description: IntentDescription? = IntentDescription(
        "Banerį perjungia į kitą kelionės etapą."
    )

    static let supportedModes: IntentModes = .background

    func perform() async throws -> some IntentResult {
        await TripBanner.shared.snooze()
        BannerActionQueue.post("trip-snooze")
        return .result()
    }
}
