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
    case ferry
    case other

    /// Maps a GTFS `route_id` to a category.
    ///
    /// Vilnius `route_id`s have the shape `vilnius_<category>_<name>`, verified
    /// across all 115 routes in the feed. Anything unrecognised becomes
    /// `.other` rather than being forced into a neighbouring case — the feed
    /// publishes only current service, so seasonal or event categories can
    /// appear that were not there when this was written.
    public static func from(routeID: String) -> TransitCategory {
        switch routeID.rsplit_prefix() {
        case "vilnius_bus":         .bus
        case "vilnius_expressbus":  .expressBus
        case "vilnius_nightbus":    .nightBus
        case "vilnius_trol":        .trolleybus
        case "vilnius_ferry":       .ferry
        default:                    .other
        }
    }
}

private extension String {
    /// Everything up to the last underscore: `vilnius_bus_12` -> `vilnius_bus`.
    func rsplit_prefix() -> String {
        guard let index = lastIndex(of: "_") else { return self }
        return String(self[startIndex..<index])
    }
}

/// Fallback route colours.
///
/// **These are a fallback, not the source of truth.** The real colours come
/// from the GTFS feed (`routes.txt` -> `route_color` / `route_text_color`) and
/// are read at runtime. This table exists only for the case where the feed is
/// missing a colour.
///
/// Verified against the live feed on 2026-09-23, across all 115 routes. Two
/// values from the spec's snapshot were wrong and are corrected here:
/// night buses are black rather than blue, and a ferry category exists that
/// the spec did not list at all. See `docs/data-formats.md`.
public enum TransitPalette {

    /// Hex values as published by the feed for every route in that category.
    public static func fallbackBackgroundHex(for category: TransitCategory) -> String {
        switch category {
        case .bus:         "0073AC"
        case .expressBus:  "008000"
        case .nightBus:    "000000"   // spec said 0073AC; the feed says black
        case .trolleybus:  "DC3131"
        case .ferry:       "00A59B"   // absent from the spec entirely
        case .other:       "0073AC"   // unknown category: fall back to bus blue
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
