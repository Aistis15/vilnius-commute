import Foundation
import SwiftUI          // Color(hex:) is an extension on SwiftUI.Color
import Testing

@testable import Core

@Suite("GTFS colour parsing")
struct ColorHexTests {

    @Test("Six-digit hex, as GTFS stores it")
    func parsesPlainHex() {
        #expect(TransitPalette.normalizeHex("0073AC") == "0073AC")
        #expect(TransitPalette.normalizeHex("dc3131") == "DC3131")
    }

    @Test("A leading # is tolerated for hand-written overrides")
    func parsesLeadingHash() {
        #expect(TransitPalette.normalizeHex("#008000") == "008000")
    }

    @Test("Malformed values are rejected rather than guessed at")
    func rejectsGarbage() {
        #expect(TransitPalette.normalizeHex("") == nil)
        #expect(TransitPalette.normalizeHex("00FF") == nil)       // too short
        #expect(TransitPalette.normalizeHex("0073ACFF") == nil)   // eight digits
        #expect(TransitPalette.normalizeHex("ZZZZZZ") == nil)
        #expect(TransitPalette.normalizeHex("######") == nil)
        #expect(TransitPalette.normalizeHex("00 73AC") == nil)
    }

    @Test("Whitespace around a feed value is ignored")
    func trimsWhitespace() {
        #expect(TransitPalette.normalizeHex("  0073AC \n") == "0073AC")
    }

    @Test("Anything that normalises also produces a Color")
    func normalizedAlwaysBuildsAColor() {
        for raw in ["0073AC", "#008000", "dc3131", "FFFFFF", "000000"] {
            #expect(Color(hex: raw) != nil)
        }
    }
}

@Suite("Route colour resolution")
struct RouteRefTests {

    @Test("A colour from the feed wins over the fallback table")
    func prefersFeedColor() {
        let route = RouteRef(
            routeID: "vilnius_bus_1", shortName: "1",
            category: .bus, colorHex: "123456"
        )
        #expect(route.effectiveBackgroundHex == "123456")
        #expect(route.effectiveBackgroundHex != TransitPalette.fallbackBackgroundHex(for: .bus))
    }

    @Test("Missing feed colour falls back per category")
    func fallsBackByCategory() {
        for category in TransitCategory.allCases {
            let route = RouteRef(routeID: "x", shortName: "1", category: category)
            #expect(route.effectiveBackgroundHex == TransitPalette.fallbackBackgroundHex(for: category))
            #expect(route.effectiveForegroundHex == TransitPalette.fallbackForegroundHex)
        }
    }

    @Test("An unparseable feed colour falls back instead of rendering colourless")
    func fallsBackOnBadHex() {
        let broken = RouteRef(
            routeID: "x", shortName: "1", category: .trolleybus, colorHex: "not-a-colour"
        )
        #expect(broken.effectiveBackgroundHex == TransitPalette.fallbackBackgroundHex(for: .trolleybus))
    }

    @Test("Feed text colour is honoured when present")
    func honoursFeedTextColor() {
        let route = RouteRef(
            routeID: "x", shortName: "1", category: .bus,
            colorHex: "0073AC", textColorHex: "#000000"
        )
        #expect(route.effectiveForegroundHex == "000000")
    }

    @Test("Every category has a usable fallback, so no badge can render colourless")
    func everyCategoryHasAFallback() {
        for category in TransitCategory.allCases {
            let hex = TransitPalette.fallbackBackgroundHex(for: category)
            #expect(TransitPalette.normalizeHex(hex) == hex)
        }
        #expect(TransitPalette.normalizeHex(TransitPalette.fallbackForegroundHex) != nil)
    }

    @Test("Fallback values match the live feed, inventoried 2026-09-23")
    func fallbackMatchesLiveFeed() {
        // Read off all 115 routes in routes.txt. Two of these correct the
        // spec's snapshot table — see docs/data-formats.md.
        #expect(TransitPalette.fallbackBackgroundHex(for: .bus) == "0073AC")
        #expect(TransitPalette.fallbackBackgroundHex(for: .expressBus) == "008000")
        #expect(TransitPalette.fallbackBackgroundHex(for: .trolleybus) == "DC3131")
        // The spec said 0073AC. The feed says black, for all 9 night routes.
        #expect(TransitPalette.fallbackBackgroundHex(for: .nightBus) == "000000")
        // A category the spec did not list at all.
        #expect(TransitPalette.fallbackBackgroundHex(for: .ferry) == "00A59B")
        // FFFFFF on every one of the 115 routes.
        #expect(TransitPalette.fallbackForegroundHex == "FFFFFF")
    }
}

@Suite("Category from route_id")
struct TransitCategoryTests {

    @Test("Every prefix in the live feed maps to its category")
    func mapsLiveFeedPrefixes() {
        #expect(TransitCategory.from(routeID: "vilnius_bus_12") == .bus)
        #expect(TransitCategory.from(routeID: "vilnius_trol_2") == .trolleybus)
        #expect(TransitCategory.from(routeID: "vilnius_expressbus_3G") == .expressBus)
        #expect(TransitCategory.from(routeID: "vilnius_nightbus_N1") == .nightBus)
        #expect(TransitCategory.from(routeID: "vilnius_ferry_L1") == .ferry)
    }

    /// `3G-A` is a real route and contains a hyphen, so splitting on the last
    /// underscore has to survive it.
    @Test("Names containing punctuation still resolve")
    func handlesPunctuatedNames() {
        #expect(TransitCategory.from(routeID: "vilnius_expressbus_3G-A") == .expressBus)
    }

    /// The feed publishes only current service, so event and seasonal
    /// categories can appear that did not exist when this was written. They
    /// must render, not crash.
    @Test("An unknown category degrades to .other instead of guessing")
    func unknownBecomesOther() {
        #expect(TransitCategory.from(routeID: "vilnius_tram_7") == .other)
        #expect(TransitCategory.from(routeID: "kaunas_bus_1") == .other)
        #expect(TransitCategory.from(routeID: "nounderscores") == .other)
        #expect(TransitCategory.from(routeID: "") == .other)
    }

    @Test("Every category still has a usable colour, including .other")
    func everyCategoryRenders() {
        for category in TransitCategory.allCases {
            #expect(TransitPalette.normalizeHex(
                TransitPalette.fallbackBackgroundHex(for: category)
            ) != nil)
        }
    }
}
