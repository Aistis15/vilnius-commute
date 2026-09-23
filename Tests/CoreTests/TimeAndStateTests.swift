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

    @Test("Countdown range is valid while departure is in the future")
    func rangeIsForwards() {
        let now = Date()
        let state = TripContentState(
            leaveAt: now.addingTimeInterval(600),
            arriveBy: now.addingTimeInterval(1800),
            routes: [.previewBus]
        )
        let range = state.countdownRange(now: now)
        #expect(range.lowerBound == now)
        #expect(range.upperBound > range.lowerBound)
    }

    /// `Text(timerInterval:)` traps on an inverted range, which is exactly
    /// what happens once departure passes while the banner is still up.
    @Test("Countdown range never inverts once departure has passed")
    func rangeClampsAfterDeparture() {
        let now = Date()
        let state = TripContentState(
            leaveAt: now.addingTimeInterval(-300),
            arriveBy: now.addingTimeInterval(600),
            routes: [.previewBus]
        )
        let range = state.countdownRange(now: now)
        #expect(range.lowerBound <= range.upperBound)
        #expect(range.upperBound == now)
    }

    @Test("hasDeparted flips at the leave time")
    func reportsDeparture() {
        let past = TripContentState(
            leaveAt: Date().addingTimeInterval(-1),
            arriveBy: Date().addingTimeInterval(600),
            routes: []
        )
        let future = TripContentState(
            leaveAt: Date().addingTimeInterval(600),
            arriveBy: Date().addingTimeInterval(1200),
            routes: []
        )
        #expect(past.hasDeparted)
        #expect(!future.hasDeparted)
    }

    @Test("Content state survives a Codable round trip")
    func roundTripsThroughCodable() throws {
        // ActivityKit encodes the state to hand it to the widget process, so a
        // type that does not round-trip silently breaks the Live Activity.
        let original = TripContentState.sample()
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(TripContentState.self, from: data)
        #expect(decoded == original)
        #expect(decoded.routes.map(\.shortName) == original.routes.map(\.shortName))
    }
}
