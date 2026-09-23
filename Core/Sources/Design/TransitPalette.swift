import SwiftUI

/// Identifies what kind of vehicle a route is, so the UI can pick a colour
/// when the feed does not supply one.
///
/// Cases are deliberately open-ended: Phase 2 inventories every `route_id`
/// prefix and `route_type` in the live Vilnius feed, and anything unrecognised
/// must still render. `.other` is the catch-all that makes that true.
public enum TransitCategory: String, Sendable, Hashable, Codable, CaseIterable {
    case bus
    case expressBus
    case nightBus
    case trolleybus
    case other
}

/// Fallback route colours.
///
/// **These are a fallback, not the source of truth.** The real colours come
/// from the GTFS feed (`routes.txt` -> `route_color` / `route_text_color`) and
/// are read at runtime. This table exists only for the case where the feed is
/// missing a colour, and it holds exactly the values recorded in the spec from
/// a snapshot of github.com/vilnius/transportas.
///
/// - Warning: The snapshot these came from may be outdated — the spec itself
///   flags the night-bus entry as stale. Phase 2 replaces this by inventorying
///   the live feed. Nothing here has been verified against the current data.
public enum TransitPalette {

    /// Hex values exactly as recorded in the spec snapshot.
    public static func fallbackBackgroundHex(for category: TransitCategory) -> String {
        switch category {
        case .bus:         "0073AC"
        case .expressBus:  "008000"
        case .nightBus:    "0073AC"
        case .trolleybus:  "DC3131"
        case .other:       "0073AC"
        }
    }

    public static let fallbackForegroundHex = "FFFFFF"

    public static func fallbackBackground(for category: TransitCategory) -> Color {
        Color(hex: fallbackBackgroundHex(for: category)) ?? .blue
    }

    public static var fallbackForeground: Color {
        Color(hex: fallbackForegroundHex) ?? .white
    }
}

public extension TransitPalette {
    /// Validates and normalises a GTFS colour to six uppercase hex digits.
    ///
    /// Returns `nil` for anything that is not a colour, which is what lets
    /// callers fall back deliberately instead of rendering a badge with no
    /// colour at all.
    static func normalizeHex(_ raw: String) -> String? {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if value.hasPrefix("#") { value.removeFirst() }
        guard value.count == 6,
              value.allSatisfy({ $0.isHexDigit }),
              UInt32(value, radix: 16) != nil
        else { return nil }
        return value
    }
}

public extension Color {
    /// Parses a GTFS colour. GTFS stores them as six hex digits with no `#`,
    /// but the leading `#` is tolerated because hand-written overrides use it.
    init?(hex: String) {
        guard let normalized = TransitPalette.normalizeHex(hex),
              let value = UInt32(normalized, radix: 16)
        else { return nil }
        self.init(
            .sRGB,
            red:   Double((value >> 16) & 0xFF) / 255,
            green: Double((value >>  8) & 0xFF) / 255,
            blue:  Double( value        & 0xFF) / 255,
            opacity: 1
        )
    }
}
