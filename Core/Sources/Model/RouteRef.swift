import SwiftUI

/// A route as the UI needs to draw it: what to print on the badge and what
/// colours to print it in.
///
/// Colours are carried on the value rather than looked up in the view, so that
/// Phase 2 can feed them straight from `routes.txt` without touching any view
/// code. `colorHex == nil` means "the feed had nothing", and only then does the
/// fallback table apply.
public struct RouteRef: Sendable, Hashable, Codable, Identifiable {
    public var id: String { routeID }

    /// GTFS `route_id`, e.g. `vilnius_expressbus_3G`.
    public let routeID: String
    /// What a rider calls it and what goes on the badge, e.g. `3G`.
    public let shortName: String
    public let category: TransitCategory
    /// GTFS `route_color`, six hex digits, no `#`. `nil` when absent.
    public let colorHex: String?
    /// GTFS `route_text_color`. `nil` when absent.
    public let textColorHex: String?

    public init(
        routeID: String,
        shortName: String,
        category: TransitCategory,
        colorHex: String? = nil,
        textColorHex: String? = nil
    ) {
        self.routeID = routeID
        self.shortName = shortName
        self.category = category
        self.colorHex = colorHex
        self.textColorHex = textColorHex
    }

    /// The colour actually used, as six uppercase hex digits.
    ///
    /// Resolution is kept on strings rather than on `Color` so the rule "feed
    /// wins, fallback only when the feed is missing or malformed" can be
    /// asserted in tests. `Color` equality is not a dependable thing to test
    /// against.
    public var effectiveBackgroundHex: String {
        colorHex.flatMap(TransitPalette.normalizeHex)
            ?? TransitPalette.fallbackBackgroundHex(for: category)
    }

    public var effectiveForegroundHex: String {
        textColorHex.flatMap(TransitPalette.normalizeHex)
            ?? TransitPalette.fallbackForegroundHex
    }

    /// Feed colour if present, fallback table otherwise.
    public var background: Color {
        Color(hex: effectiveBackgroundHex) ?? TransitPalette.fallbackBackground(for: category)
    }

    public var foreground: Color {
        Color(hex: effectiveForegroundHex) ?? TransitPalette.fallbackForeground
    }
}
