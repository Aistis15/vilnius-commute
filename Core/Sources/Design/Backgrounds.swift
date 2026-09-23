import SwiftUI
import UIKit

// Background colours for app screens.
//
// iOS draws grouped content on pure black in dark mode (#000000 page,
// #1C1C1E cards) — that is what Settings.app looks like. This app uses a dark
// grey page instead, with the cards a step lighter again, so the layers stay
// distinguishable without the harshness of true black at night.
//
// The mapping is exactly one step up iOS's own grouped-background ladder in
// dark mode, and unchanged in light mode. Nothing is invented: these are
// system colours, so they track contrast settings and future OS changes.
//
//              light            dark (default)   dark (here)
//   page       #F2F2F7          #000000          #1C1C1E
//   card       #FFFFFF          #1C1C1E          #2C2C2E

public extension Color {

    /// Behind everything on a screen.
    static let pageBackground = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? .secondarySystemGroupedBackground
            : .systemGroupedBackground
    })

    /// The grouped rows that sit on top of `pageBackground`.
    static let cardBackground = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? .tertiarySystemGroupedBackground
            : .secondarySystemGroupedBackground
    })
}

public extension View {

    /// Applies the app's list chrome: dark-grey page, lighter cards.
    ///
    /// `scrollContentBackground(.hidden)` is what allows the page colour to
    /// show through — without it the `List` paints its own system background
    /// over the top and nothing changes.
    func commuteListChrome() -> some View {
        self
            .scrollContentBackground(.hidden)
            .background(Color.pageBackground)
            .listRowBackground(Color.cardBackground)
    }
}
