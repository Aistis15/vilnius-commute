import Foundation

/// Clock formatting for the whole app.
///
/// Times are always rendered 24-hour. Lithuanian uses a 24-hour clock, but a
/// device set to 12-hour would otherwise override a locale-driven format style
/// and print "1:52 PM" in the middle of Lithuanian copy. A verbatim style
/// pins it.
public enum TimeFormat {

    private static let clockStyle = Date.VerbatimFormatStyle(
        format: "\(hour: .twoDigits(clock: .twentyFourHour, hourCycle: .zeroBased)):\(minute: .twoDigits)",
        timeZone: .current,
        calendar: .current
    )

    /// `13:52`
    public static func clock(_ date: Date) -> String {
        date.formatted(clockStyle)
    }

    /// Whole minutes remaining, floored at zero.
    public static func minutesUntil(_ date: Date, from now: Date = .now) -> Int {
        max(0, Int(date.timeIntervalSince(now) / 60))
    }
}
