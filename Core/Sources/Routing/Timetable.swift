import Foundation

/// The whole Vilnius network, laid out as flat arrays for RAPTOR.
///
/// RAPTOR touches this in tight inner loops — for every round, for every
/// pattern it has marked, it walks that pattern's stops in order. Dictionaries
/// and reference types would dominate the runtime, so everything is indexed by
/// dense `Int32` and stored contiguously.
///
/// The database this comes from is built in CI by `Tools/gtfs/build_db.py`.
/// Its ids are already dense and 0-based precisely so they can be used as
/// array subscripts here without a translation step.
public struct Timetable: Sendable {

    public struct Stop: Sendable {
        public let id: Int32
        public let name: String
        public let latitude: Double
        public let longitude: Double
    }

    public struct Route: Sendable {
        public let id: Int32
        public let shortName: String
        public let category: TransitCategory
        public let colorHex: String?
        public let textColorHex: String?

        public var reference: RouteRef {
            RouteRef(
                routeID: "\(id)",
                shortName: shortName,
                category: category,
                colorHex: colorHex,
                textColorHex: textColorHex
            )
        }
    }

    /// A RAPTOR route: every trip here visits the same stops in the same order.
    public struct Pattern: Sendable {
        public let id: Int32
        public let routeID: Int32
        public let headsign: String?
        /// Slice of `patternStops` holding this pattern's stop ids, in order.
        public let stopRange: Range<Int>
        /// Slice of `trips` holding this pattern's trips, sorted by departure.
        public let tripRange: Range<Int>
    }

    public struct Trip: Sendable {
        public let id: Int32
        public let serviceID: Int32
        /// Offset into `arrivals` / `departures` for this trip's first stop.
        public let timeOffset: Int
    }

    public struct Transfer: Sendable {
        public let target: Int32
        public let metres: Int32
    }

    // MARK: - Storage

    public let stops: [Stop]
    public let routes: [Route]
    public let patterns: [Pattern]

    /// Stop ids for every pattern, concatenated. Slice with `Pattern.stopRange`.
    public let patternStops: [Int32]

    /// Trips for every pattern, concatenated and sorted by departure time.
    public let trips: [Trip]

    /// Seconds from the service day's midnight. **These exceed 86 400** for
    /// service that runs past midnight — the Vilnius feed reaches 30:11:00.
    /// Indexed by `Trip.timeOffset + positionInPattern`.
    public let arrivals: [Int32]
    public let departures: [Int32]

    /// Which patterns call at a given stop, and at what position.
    /// `patternsAtStop[stopID]` -> [(pattern, index within the pattern)]
    public let patternsAtStop: [[(pattern: Int32, index: Int32)]]

    /// Walkable neighbours, derived at build time because the feed ships no
    /// `transfers.txt`. Distance only — walking speed is a user preference.
    public let transfers: [[Transfer]]

    public let calendar: ServiceCalendar

    public init(
        stops: [Stop],
        routes: [Route],
        patterns: [Pattern],
        patternStops: [Int32],
        trips: [Trip],
        arrivals: [Int32],
        departures: [Int32],
        patternsAtStop: [[(pattern: Int32, index: Int32)]],
        transfers: [[Transfer]],
        calendar: ServiceCalendar
    ) {
        self.stops = stops
        self.routes = routes
        self.patterns = patterns
        self.patternStops = patternStops
        self.trips = trips
        self.arrivals = arrivals
        self.departures = departures
        self.patternsAtStop = patternsAtStop
        self.transfers = transfers
        self.calendar = calendar
    }

    // MARK: - Lookup helpers

    public func stopIDs(of pattern: Pattern) -> ArraySlice<Int32> {
        patternStops[pattern.stopRange]
    }

    /// Arrival at `index` along `pattern` for the trip stored at `tripSlot`.
    public func arrival(tripSlot: Int, index: Int) -> Int32 {
        arrivals[trips[tripSlot].timeOffset + index]
    }

    public func departure(tripSlot: Int, index: Int) -> Int32 {
        departures[trips[tripSlot].timeOffset + index]
    }

    public func route(of pattern: Pattern) -> Route {
        routes[Int(pattern.routeID)]
    }
}

/// Which services run on a given day.
///
/// GTFS says this twice: a weekly pattern with a date range in `calendar.txt`,
/// and per-date overrides in `calendar_dates.txt`. The overrides win. The
/// Vilnius feed leans on them heavily — 2 746 exception rows against 238
/// services — so ignoring them would put buses on the road on the wrong days.
public struct ServiceCalendar: Sendable {

    public struct Service: Sendable {
        /// Bit 0 = Monday … bit 6 = Sunday.
        public let weekdays: UInt8
        public let startDate: Int32      // yyyymmdd
        public let endDate: Int32

        public init(weekdays: UInt8, startDate: Int32, endDate: Int32) {
            self.weekdays = weekdays
            self.startDate = startDate
            self.endDate = endDate
        }
    }

    private let services: [Service]
    /// serviceID -> date -> added. Overrides the weekly pattern.
    private let exceptions: [Int32: [Int32: Bool]]

    public init(services: [Service], exceptions: [Int32: [Int32: Bool]]) {
        self.services = services
        self.exceptions = exceptions
    }

    public var count: Int { services.count }

    /// - Parameters:
    ///   - date: yyyymmdd
    ///   - weekday: 0 = Monday … 6 = Sunday
    public func runs(serviceID: Int32, on date: Int32, weekday: Int) -> Bool {
        if let override = exceptions[serviceID]?[date] {
            return override
        }
        let index = Int(serviceID)
        guard index >= 0, index < services.count else { return false }
        let service = services[index]
        guard date >= service.startDate, date <= service.endDate else { return false }
        return service.weekdays & (1 << UInt8(weekday)) != 0
    }
}
