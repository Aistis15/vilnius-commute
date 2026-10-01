import ActivityKit
import Foundation

/// What the trip banner will say, kept by the app between page messages.
///
/// The page sends every moment still ahead (`activity` message); this is
/// where they wait. It lives in the app's Application Support folder, which
/// the banner's intents can read because a `LiveActivityIntent` runs in the
/// app's process, not the widget's.
public struct TripMoments: Codable, Hashable, Sendable {
    public var destination: String
    public var palette: BannerPalette
    public var moments: [BannerMoment]
    /// The moment the banner shows, from 0.
    public var momentIndex: Int
    /// The page of that moment.
    public var pageIndex: Int
    /// "Dar ne" moves the banner on to this moment even before its time.
    public var heldFrom: Int

    public init(destination: String, palette: BannerPalette, moments: [BannerMoment],
                momentIndex: Int = 0, pageIndex: Int = 0, heldFrom: Int = 0) {
        self.destination = destination
        self.palette = palette
        self.moments = moments.sorted { $0.at < $1.at }
        self.momentIndex = momentIndex
        self.pageIndex = pageIndex
        self.heldFrom = heldFrom
    }

    /// The moment due at `now`: the last one whose time has come (the first
    /// is "now" by contract), or a later one the rider moved on to.
    public func dueIndex(at now: Date) -> Int {
        guard !moments.isEmpty else { return 0 }
        let ms = now.timeIntervalSince1970 * 1000
        let byTime = moments.lastIndex { $0.at <= ms } ?? 0
        return min(max(byTime, heldFrom), moments.count - 1)
    }

    /// Moves to the moment due at `now`. A new moment starts on its first page.
    /// Returns whether anything changed.
    @discardableResult
    public mutating func advance(to now: Date) -> Bool {
        let due = dueIndex(at: now)
        if due == momentIndex {
            let clamped = min(max(pageIndex, 0), max(pageCount - 1, 0))
            let changed = clamped != pageIndex
            pageIndex = clamped
            return changed
        }
        momentIndex = due
        pageIndex = 0
        return true
    }

    public var pageCount: Int {
        moments.indices.contains(momentIndex) ? moments[momentIndex].pages.count : 0
    }

    /// The content the banner should show, or nil when there is nothing.
    public var state: TripContentState? {
        guard moments.indices.contains(momentIndex) else { return nil }
        let pages = moments[momentIndex].pages
        guard !pages.isEmpty else { return nil }
        let index = min(max(pageIndex, 0), pages.count - 1)
        return TripContentState(page: pages[index], pageIndex: index,
                                pageCount: pages.count, palette: palette)
    }

    /// When the banner goes out of date: the next moment's time.
    public var staleDate: Date? {
        let next = momentIndex + 1
        return moments.indices.contains(next) ? moments[next].date : nil
    }

    public mutating func nextPage() {
        let count = pageCount
        guard count > 1 else { return }
        pageIndex = (pageIndex + 1) % count
    }

    /// "Dar ne": on to the next moment, if there is one.
    @discardableResult
    public mutating func snooze() -> Bool {
        let next = momentIndex + 1
        guard moments.indices.contains(next) else { return false }
        heldFrom = next
        momentIndex = next
        pageIndex = 0
        return true
    }

    // MARK: - On disk

    static var fileURL: URL? {
        guard let support = FileManager.default.urls(for: .applicationSupportDirectory,
                                                     in: .userDomainMask).first
        else { return nil }
        return support.appendingPathComponent("trip-banner.json")
    }

    public static func load() -> TripMoments? {
        guard let url = fileURL, let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(TripMoments.self, from: data)
    }

    public func save() {
        guard let url = Self.fileURL else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(),
                                                 withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(self) {
            try? data.write(to: url, options: .atomic)
        }
    }

    public static func clear() {
        guard let url = fileURL else { return }
        try? FileManager.default.removeItem(at: url)
    }
}

/// Starts, updates and ends the trip banner from the page's moments.
///
/// One actor so a tap on the banner (an intent) and a location update in the
/// app cannot interleave their read-modify-write of the moments. ActivityKit
/// work is done in `nonisolated` helpers that take only Sendable values:
/// `Activity` is not Sendable, so it is looked up by id where it is used
/// (see `TripActivityController` for the full reasoning).
public actor TripBanner {

    public static let shared = TripBanner()

    public enum Failure: Error, CustomStringConvertible {
        case disabled
        case nothingToShow

        public var description: String {
            switch self {
            case .disabled: "Gyvosios veiklos išjungtos sistemoje."
            case .nothingToShow: "Kelionėje nėra ką rodyti."
            }
        }
    }

    /// Handles `{type: "activity"}` from the page.
    public func handle(_ message: ActivityMessage, now: Date = .now) async throws {
        switch message.op {
        case .end:
            await endTrip()
        case .start, .update:
            let previous = TripMoments.load()
            var trip = TripMoments(
                destination: message.destination ?? previous?.destination ?? "",
                palette: message.palette ?? previous?.palette ?? .grafitas,
                moments: message.moments ?? previous?.moments ?? []
            )
            trip.momentIndex = trip.dueIndex(at: now)
            trip.pageIndex = message.page ?? 0
            trip.advance(to: now)
            guard let state = trip.state else { throw Failure.nothingToShow }
            trip.save()
            try await Self.show(destination: trip.destination, state: state, staleDate: trip.staleDate)
        }
    }

    /// Switches to the moment due now. Called as time passes: on location
    /// updates during a trip, on a timer while the app is open, and when the
    /// app comes back. Does nothing when nothing changed.
    public func refresh(now: Date = .now) async {
        guard var trip = TripMoments.load() else { return }
        guard trip.advance(to: now) else { return }
        trip.save()
        guard let state = trip.state else { return }
        await Self.update(state: state, staleDate: trip.staleDate)
    }

    /// The corner button.
    public func nextPage() async {
        guard var trip = TripMoments.load() else { return }
        trip.advance(to: .now)
        trip.nextPage()
        trip.save()
        guard let state = trip.state else { return }
        await Self.update(state: state, staleDate: trip.staleDate)
    }

    /// "Dar ne".
    public func snooze() async {
        guard var trip = TripMoments.load() else { return }
        trip.advance(to: .now)
        guard trip.snooze() else { return }
        trip.save()
        guard let state = trip.state else { return }
        await Self.update(state: state, staleDate: trip.staleDate)
    }

    /// "Taip", or the page ending the trip.
    public func endTrip() async {
        TripMoments.clear()
        await Self.endAll()
    }

    public nonisolated var isRunning: Bool {
        Activity<TripActivityAttributes>.activities.contains { $0.activityState == .active }
    }

    // MARK: - ActivityKit

    /// Updates the running banner, or puts one up.
    private nonisolated static func show(destination: String, state: TripContentState,
                                         staleDate: Date?) async throws {
        let content = ActivityContent(state: state, staleDate: staleDate)
        if let running = Activity<TripActivityAttributes>.activities
            .first(where: { $0.activityState == .active }) {
            // The destination is fixed for an activity's life: a new one
            // means a new trip.
            if running.attributes.destinationName == destination || destination.isEmpty {
                await running.update(content)
                return
            }
            await running.end(nil, dismissalPolicy: .immediate)
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { throw Failure.disabled }
        _ = try Activity.request(
            attributes: TripActivityAttributes(destinationName: destination),
            content: content,
            pushType: nil          // local updates only: a free Apple ID has no push
        )
    }

    private nonisolated static func update(state: TripContentState, staleDate: Date?) async {
        for activity in Activity<TripActivityAttributes>.activities where activity.activityState == .active {
            if activity.content.state == state, activity.content.staleDate == staleDate { continue }
            await activity.update(ActivityContent(state: state, staleDate: staleDate))
        }
    }

    private nonisolated static func endAll() async {
        for activity in Activity<TripActivityAttributes>.activities {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }
}

/// Taps on the banner that the page should hear about: `trip`, `replan`,
/// `trip-done`, `trip-snooze`, `page:<n>`.
///
/// The intents run in the app's process, maybe with no web view alive, so
/// each tap is queued in `UserDefaults` and announced; the shell drains the
/// queue when the page is there to hear it.
public enum BannerActionQueue {
    public static let notification = Notification.Name("VCBannerAction")
    private static let key = "vc.bannerActions"

    public static func post(_ name: String) {
        let defaults = UserDefaults.standard
        var queue = defaults.stringArray(forKey: key) ?? []
        queue.append(name)
        defaults.set(Array(queue.suffix(20)), forKey: key)
        NotificationCenter.default.post(name: notification, object: nil)
    }

    public static func drain() -> [String] {
        let defaults = UserDefaults.standard
        let queue = defaults.stringArray(forKey: key) ?? []
        defaults.removeObject(forKey: key)
        return queue
    }
}
