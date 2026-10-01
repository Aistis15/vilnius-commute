import ActivityKit
import Foundation

/// The Live Activity for one trip.
///
/// The banner is drawn from data the page computes ("The banner as data" in
/// docs/ios-shell.md): the content state carries the one page on screen now
/// and the user's colourway. Everything else the trip will say later lives
/// in the app (`TripMoments`), so the state stays far under ActivityKit's
/// 4 KB limit.
public struct TripActivityAttributes: ActivityAttributes, Sendable {

    public typealias ContentState = TripContentState

    /// Where the trip ends, e.g. `ISM`. Fixed for the life of the Activity.
    public let destinationName: String

    public init(destinationName: String) {
        self.destinationName = destinationName
    }
}

/// The part of the Live Activity that changes over time.
public struct TripContentState: Codable, Hashable, Sendable {

    /// The page on screen.
    public var page: BannerPage
    /// Which of the current moment's pages it is, from 0.
    public var pageIndex: Int
    /// How many pages the current moment has. The corner button and its
    /// dots show only when there is more than one.
    public var pageCount: Int
    public var palette: BannerPalette

    public init(page: BannerPage, pageIndex: Int = 0, pageCount: Int = 1,
                palette: BannerPalette = .grafitas) {
        self.page = page
        self.pageIndex = pageIndex
        self.pageCount = pageCount
        self.palette = palette
    }

    public var hasPages: Bool { pageCount > 1 }

    /// See `BannerPage.countdownRange(now:)`.
    public func countdownRange(now: Date = .now) -> ClosedRange<Date>? {
        page.countdownRange(now: now)
    }
}
