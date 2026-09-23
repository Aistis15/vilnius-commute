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

    @Test("Fallback values match the snapshot recorded in the spec")
    func fallbackMatchesSpecSnapshot() {
        // These are provisional: Phase 2 replaces them by inventorying the
        // live feed. The test pins them so a change has to be deliberate.
        #expect(TransitPalette.fallbackBackgroundHex(for: .bus) == "0073AC")
        #expect(TransitPalette.fallbackBackgroundHex(for: .expressBus) == "008000")
        #expect(TransitPalette.fallbackBackgroundHex(for: .nightBus) == "0073AC")
        #expect(TransitPalette.fallbackBackgroundHex(for: .trolleybus) == "DC3131")
        #expect(TransitPalette.fallbackForegroundHex == "FFFFFF")
    }
}
