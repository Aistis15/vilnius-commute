import Foundation
import Testing

@testable import Core

@Suite("Clock formatting")
struct TimeFormatTests {

    /// Builds a date in the current calendar/timezone, which is what
    /// `TimeFormat` formats against.
    private func date(hour: Int, minute: Int) -> Date {
        var components = DateComponents()
        components.year = 2026
        components.month = 9
        components.day = 23
        components.hour = hour
        components.minute = minute
        return Calendar.current.date(from: components)!
    }

    @Test("Afternoon times stay on a 24-hour clock")
    func rendersTwentyFourHour() {
        #expect(TimeFormat.clock(date(hour: 13, minute: 52)) == "13:52")
        #expect(TimeFormat.clock(date(hour: 20, minute: 0)) == "20:00")
    }

    @Test("Hours and minutes are always two digits")
    func padsWithZeros() {
        #expect(TimeFormat.clock(date(hour: 9, minute: 5)) == "09:05")
        #expect(TimeFormat.clock(date(hour: 0, minute: 0)) == "00:00")
    }

    @Test("Minutes remaining are floored, never negative")
    func minutesUntilFloorsAtZero() {
        let now = date(hour: 13, minute: 0)
        #expect(TimeFormat.minutesUntil(now.addingTimeInterval(12 * 60), from: now) == 12)
        #expect(TimeFormat.minutesUntil(now.addingTimeInterval(119), from: now) == 1)
        #expect(TimeFormat.minutesUntil(now.addingTimeInterval(-600), from: now) == 0)
        #expect(TimeFormat.minutesUntil(now, from: now) == 0)
    }
}

@Suite("Live Activity content state")
struct TripContentStateTests {

    private func page(until: Date?) -> BannerPage {
        var page = BannerSamples.countdown
        page.right?.until = until.map { $0.timeIntervalSince1970 * 1000 }
        return page
    }

    @Test("Countdown range is valid while the target is in the future")
    func rangeIsForwards() throws {
        let now = Date()
        let state = TripContentState(page: page(until: now.addingTimeInterval(600)))
        let range = try #require(state.countdownRange(now: now))
        #expect(range.lowerBound == now)
        #expect(range.upperBound > range.lowerBound)
    }

    /// `Text(timerInterval:)` traps on an inverted range, which is exactly
    /// what happens once the target passes while the banner is still up.
    @Test("Countdown range never inverts once the target has passed")
    func rangeClampsAfterTarget() throws {
        let now = Date()
        let state = TripContentState(page: page(until: now.addingTimeInterval(-300)))
        let range = try #require(state.countdownRange(now: now))
        #expect(range.lowerBound <= range.upperBound)
        #expect(range.upperBound == now)
    }

    @Test("No until, no timer")
    func noUntilNoRange() {
        #expect(TripContentState(page: page(until: nil)).countdownRange() == nil)
    }

    @Test("Content state survives a Codable round trip")
    func roundTripsThroughCodable() throws {
        // ActivityKit encodes the state to hand it to the widget process, so a
        // type that does not round-trip silently breaks the Live Activity.
        for (_, page) in BannerSamples.stages {
            let original = BannerSamples.state(page, palette: .smelis)
            let data = try JSONEncoder().encode(original)
            let decoded = try JSONDecoder().decode(TripContentState.self, from: data)
            #expect(decoded == original)
        }
    }

    /// ActivityKit's limit for the content state is 4 KB.
    @Test("Content state stays well under 4 KB")
    func staysSmall() throws {
        for (_, page) in BannerSamples.stages {
            let data = try JSONEncoder().encode(BannerSamples.state(page))
            #expect(data.count < 2048)
        }
    }
}

@Suite("Banner as data")
struct BannerDataTests {

    /// The message exactly as the contract writes it.
    @Test("An activity message from the page decodes")
    func decodesContractMessage() throws {
        let json = """
        {"type":"activity","op":"start","destination":"ISM",
         "palette":{"base":"#1C1C1E","ink":"#FFFFFF","accent":"#FFFFFF","red":"#FF453A"},
         "moments":[{"at":1790000000000,"pages":[
           {"stage":"walk","caption":"Eik į stotelę","title":"Šv. Jurgio g.","titleKind":"text",
            "meta":"Kairėn · po 70 m","metaIcon":{"turn":-90},
            "right":{"caption":"3G atvyks","value":"4","unit":"min","until":1790000240000},
            "foot":{"progress":0.35}},
           {"stage":"ride","caption":"Važiuoji","captionRoute":{"name":"3G","color":"008000","text":"FFFFFF"},
            "title":"Persėsk į 2","titleKind":"text","metaIcon":"crossing",
            "foot":{"progress":0.55,"ticks":[0.2,0.4]}},
           {"stage":"arrive","caption":"ISM · 14:18","title":"Ar baigėte kelionę?","titleKind":"question",
            "metaIcon":null,
            "buttons":[{"label":"Taip","action":"trip-done","primary":true},{"label":"Dar ne","action":"trip-snooze"}]}
         ]}],
         "page":1}
        """
        let message = try JSONDecoder().decode(ActivityMessage.self, from: Data(json.utf8))
        #expect(message.op == .start)
        #expect(message.page == 1)
        let pages = try #require(message.moments?.first?.pages)
        #expect(pages.count == 3)
        #expect(pages[0].metaIcon == .turn(-90))
        #expect(pages[0].right?.until == 1_790_000_240_000)
        #expect(pages[1].metaIcon == .crossing)
        #expect(pages[1].leadRoute?.name == "3G")
        #expect(pages[2].metaIcon == nil)
        #expect(pages[2].buttons?.first?.isPrimary == true)
        #expect(pages[2].buttons?.last?.isPrimary == false)
    }

    @Test("A stage or kind this app does not know is not fatal")
    func lenientDecoding() throws {
        let json = #"{"stage":"teleport","caption":"","title":"?","titleKind":"hologram","metaIcon":{"spin":1}}"#
        let page = try JSONDecoder().decode(BannerPage.self, from: Data(json.utf8))
        #expect(page.stage == .countdown)
        #expect(page.titleKind == .text)
        #expect(page.metaIcon == nil)
    }

    /// The design's rule: the most legible of ink, base, black and white.
    @Test("The ink on the accent is the design's pick")
    func onAccent() {
        #expect(BannerPalette.grafitas.onAccent == "#000000")
        #expect(BannerPalette.smelis.onAccent == "#FFFFFF")
        #expect(BannerPalette.balta.onAccent == "#FFFFFF")
    }
}

@Suite("Trip moments")
struct TripMomentsTests {

    private let start = Date(timeIntervalSince1970: 1_790_000_000)

    private func trip() -> TripMoments {
        let ms = start.timeIntervalSince1970 * 1000
        return TripMoments(destination: "ISM", palette: .grafitas, moments: [
            BannerMoment(at: ms, pages: BannerSamples.pages),
            BannerMoment(at: ms + 600_000, pages: [BannerSamples.ride]),
            BannerMoment(at: ms + 1_200_000, pages: [BannerSamples.arrive]),
        ])
    }

    @Test("The moment due is the last one whose time has come")
    func dueByTime() {
        let t = trip()
        #expect(t.dueIndex(at: start.addingTimeInterval(-5)) == 0)
        #expect(t.dueIndex(at: start.addingTimeInterval(599)) == 0)
        #expect(t.dueIndex(at: start.addingTimeInterval(600)) == 1)
        #expect(t.dueIndex(at: start.addingTimeInterval(9_999)) == 2)
    }

    @Test("Pages turn round, and a new moment starts on its first page")
    func pagesTurn() throws {
        var t = trip()
        t.nextPage()
        t.nextPage()
        #expect(t.pageIndex == 2)
        t.nextPage()
        #expect(t.pageIndex == 0)
        t.nextPage()
        #expect(t.advance(to: start.addingTimeInterval(700)))
        #expect(t.momentIndex == 1)
        #expect(t.pageIndex == 0)
        let state = try #require(t.state)
        #expect(state.pageCount == 1)
        #expect(t.staleDate == start.addingTimeInterval(1_200))
    }

    @Test("Dar ne moves on, and time does not move it back")
    func snoozeHolds() {
        var t = trip()
        #expect(t.snooze())
        #expect(t.momentIndex == 1)
        #expect(!t.advance(to: start.addingTimeInterval(10)))
        #expect(t.momentIndex == 1)
        #expect(t.snooze())
        #expect(!t.snooze())        // nothing after the last moment
    }
}
