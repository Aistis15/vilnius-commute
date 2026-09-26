import Foundation
import SQLite3

/// Loads the CI-built schedule database into a `Timetable`.
///
/// Everything is read once, up front, into flat arrays. RAPTOR then runs
/// entirely in memory: querying SQLite inside the round loop would make the
/// algorithm's cost dominated by the database rather than by the search.
///
/// The whole Vilnius network is small enough for this to be reasonable —
/// roughly 1 550 stops, 690 patterns, 21 600 trips and 438 000 stop times,
/// which comes to a few megabytes of `Int32`.
public enum TimetableLoader {

    public enum Failure: Error, LocalizedError {
        case cannotOpen(String)
        case queryFailed(String)
        case schemaMismatch(found: Int, expected: Int)

        public var errorDescription: String? {
            switch self {
            case .cannotOpen(let path):
                "Nepavyko atidaryti tvarkaraščių duomenų bazės: \(path)"
            case .queryFailed(let message):
                "Klaida skaitant tvarkaraščius: \(message)"
            case .schemaMismatch(let found, let expected):
                "Duomenų bazės versija \(found), programėlė laukia \(expected)."
            }
        }
    }

    /// Bumped whenever `Tools/gtfs/build_db.py` changes shape. A mismatch is
    /// refused rather than half-read: a database from a different schema would
    /// otherwise load with silently wrong columns.
    public static let expectedSchemaVersion = 1

    public static func load(from url: URL) throws -> Timetable {
        var handle: OpaquePointer?
        let flags = SQLITE_OPEN_READONLY | SQLITE_OPEN_NOMUTEX
        guard sqlite3_open_v2(url.path(percentEncoded: false), &handle, flags, nil) == SQLITE_OK,
              let db = handle
        else {
            let message = handle.map { String(cString: sqlite3_errmsg($0)) } ?? "unknown"
            sqlite3_close_v2(handle)
            throw Failure.cannotOpen("\(url.lastPathComponent): \(message)")
        }
        defer { sqlite3_close_v2(db) }

        try checkSchema(db)

        let stops = try loadStops(db)
        let routes = try loadRoutes(db)
        let (patterns, patternStops, trips, arrivals, departures) =
            try loadPatterns(db, stopCount: stops.count)
        let patternsAtStop = buildStopIndex(
            stopCount: stops.count, patterns: patterns, patternStops: patternStops
        )
        let transfers = try loadTransfers(db, stopCount: stops.count)
        let calendar = try loadCalendar(db)

        return Timetable(
            stops: stops,
            routes: routes,
            patterns: patterns,
            patternStops: patternStops,
            trips: trips,
            arrivals: arrivals,
            departures: departures,
            patternsAtStop: patternsAtStop,
            transfers: transfers,
            calendar: calendar
        )
    }

    // MARK: - Statement plumbing

    private static func prepare(_ db: OpaquePointer, _ sql: String) throws -> OpaquePointer {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK,
              let prepared = statement
        else {
            throw Failure.queryFailed(String(cString: sqlite3_errmsg(db)))
        }
        return prepared
    }

    private static func text(_ statement: OpaquePointer, _ column: Int32) -> String? {
        guard let raw = sqlite3_column_text(statement, column) else { return nil }
        return String(cString: raw)
    }

    // MARK: - Tables

    private static func checkSchema(_ db: OpaquePointer) throws {
        let statement = try prepare(db, "SELECT value FROM meta WHERE key = 'schema_version'")
        defer { sqlite3_finalize(statement) }
        guard sqlite3_step(statement) == SQLITE_ROW,
              let value = text(statement, 0), let version = Int(value)
        else {
            throw Failure.queryFailed("meta.schema_version missing")
        }
        guard version == expectedSchemaVersion else {
            throw Failure.schemaMismatch(found: version, expected: expectedSchemaVersion)
        }
    }

    private static func loadStops(_ db: OpaquePointer) throws -> [Timetable.Stop] {
        let statement = try prepare(db, "SELECT id, name, lat, lon FROM stop ORDER BY id")
        defer { sqlite3_finalize(statement) }

        var stops: [Timetable.Stop] = []
        stops.reserveCapacity(2_000)
        while sqlite3_step(statement) == SQLITE_ROW {
            stops.append(Timetable.Stop(
                id: sqlite3_column_int(statement, 0),
                name: text(statement, 1) ?? "",
                latitude: sqlite3_column_double(statement, 2),
                longitude: sqlite3_column_double(statement, 3)
            ))
        }
        return stops
    }

    private static func loadRoutes(_ db: OpaquePointer) throws -> [Timetable.Route] {
        let statement = try prepare(
            db, "SELECT id, short_name, category, color, text_color FROM route ORDER BY id"
        )
        defer { sqlite3_finalize(statement) }

        var routes: [Timetable.Route] = []
        routes.reserveCapacity(200)
        while sqlite3_step(statement) == SQLITE_ROW {
            let raw = text(statement, 2) ?? ""
            routes.append(Timetable.Route(
                id: sqlite3_column_int(statement, 0),
                shortName: text(statement, 1) ?? "",
                // An unknown category from a newer feed degrades to `.other`
                // rather than failing the load — the feed publishes only
                // current service, so new categories can appear.
                category: TransitCategory(rawValue: raw) ?? .other,
                colorHex: text(statement, 3),
                textColorHex: text(statement, 4)
            ))
        }
        return routes
    }

    private static func loadPatterns(
        _ db: OpaquePointer, stopCount: Int
    ) throws -> ([Timetable.Pattern], [Int32], [Timetable.Trip], [Int32], [Int32]) {

        // Stop lists first, so each pattern knows its slice.
        var stopsByPattern: [Int32: [Int32]] = [:]
        do {
            let statement = try prepare(
                db, "SELECT pattern_id, stop_id FROM pattern_stop ORDER BY pattern_id, seq"
            )
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                stopsByPattern[sqlite3_column_int(statement, 0), default: []]
                    .append(sqlite3_column_int(statement, 1))
            }
        }

        // Times, keyed by trip, in stop order.
        var timesByTrip: [Int32: [(arrival: Int32, departure: Int32)]] = [:]
        do {
            let statement = try prepare(
                db, "SELECT trip_id, arrival, departure FROM trip_time ORDER BY trip_id, seq"
            )
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                timesByTrip[sqlite3_column_int(statement, 0), default: []].append((
                    sqlite3_column_int(statement, 1),
                    sqlite3_column_int(statement, 2)
                ))
            }
        }

        // Trips, already ordered by pattern then departure.
        var tripsByPattern: [Int32: [(id: Int32, service: Int32)]] = [:]
        do {
            let statement = try prepare(
                db, "SELECT id, pattern_id, service_id FROM trip ORDER BY pattern_id, departure"
            )
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                tripsByPattern[sqlite3_column_int(statement, 1), default: []].append((
                    sqlite3_column_int(statement, 0),
                    sqlite3_column_int(statement, 2)
                ))
            }
        }

        var patterns: [Timetable.Pattern] = []
        var patternStops: [Int32] = []
        var trips: [Timetable.Trip] = []
        var arrivals: [Int32] = []
        var departures: [Int32] = []

        let statement = try prepare(
            db, "SELECT id, route_id, headsign FROM pattern ORDER BY id"
        )
        defer { sqlite3_finalize(statement) }

        while sqlite3_step(statement) == SQLITE_ROW {
            let patternID = sqlite3_column_int(statement, 0)
            let stopIDs = stopsByPattern[patternID] ?? []
            guard stopIDs.count >= 2 else { continue }

            let stopStart = patternStops.count
            patternStops.append(contentsOf: stopIDs)

            let tripStart = trips.count
            for trip in tripsByPattern[patternID] ?? [] {
                guard let times = timesByTrip[trip.id], times.count == stopIDs.count else {
                    // A trip whose times do not line up with its pattern would
                    // silently mis-index the flat arrays. verify_db.py already
                    // rejects these upstream; skipping is the safe fallback.
                    continue
                }
                trips.append(Timetable.Trip(
                    id: trip.id, serviceID: trip.service, timeOffset: arrivals.count
                ))
                for time in times {
                    arrivals.append(time.arrival)
                    departures.append(time.departure)
                }
            }

            patterns.append(Timetable.Pattern(
                id: patternID,
                routeID: sqlite3_column_int(statement, 1),
                headsign: text(statement, 2),
                stopRange: stopStart..<patternStops.count,
                tripRange: tripStart..<trips.count
            ))
        }

        return (patterns, patternStops, trips, arrivals, departures)
    }

    private static func buildStopIndex(
        stopCount: Int,
        patterns: [Timetable.Pattern],
        patternStops: [Int32]
    ) -> [[(pattern: Int32, index: Int32)]] {
        var index = [[(pattern: Int32, index: Int32)]](repeating: [], count: stopCount)
        for (slot, pattern) in patterns.enumerated() {
            for (position, stopID) in patternStops[pattern.stopRange].enumerated() {
                let stop = Int(stopID)
                guard stop >= 0, stop < stopCount else { continue }
                index[stop].append((pattern: Int32(slot), index: Int32(position)))
            }
        }
        return index
    }

    private static func loadTransfers(
        _ db: OpaquePointer, stopCount: Int
    ) throws -> [[Timetable.Transfer]] {
        let statement = try prepare(
            db, "SELECT from_stop, to_stop, meters FROM transfer ORDER BY from_stop, meters"
        )
        defer { sqlite3_finalize(statement) }

        var transfers = [[Timetable.Transfer]](repeating: [], count: stopCount)
        while sqlite3_step(statement) == SQLITE_ROW {
            let from = Int(sqlite3_column_int(statement, 0))
            guard from >= 0, from < stopCount else { continue }
            transfers[from].append(Timetable.Transfer(
                target: sqlite3_column_int(statement, 1),
                metres: sqlite3_column_int(statement, 2)
            ))
        }
        return transfers
    }

    private static func loadCalendar(_ db: OpaquePointer) throws -> ServiceCalendar {
        var services: [ServiceCalendar.Service] = []
        do {
            let statement = try prepare(
                db, "SELECT id, weekdays, start_date, end_date FROM service ORDER BY id"
            )
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                services.append(ServiceCalendar.Service(
                    weekdays: UInt8(truncatingIfNeeded: sqlite3_column_int(statement, 1)),
                    startDate: sqlite3_column_int(statement, 2),
                    endDate: sqlite3_column_int(statement, 3)
                ))
            }
        }

        var exceptions: [Int32: [Int32: Bool]] = [:]
        do {
            let statement = try prepare(
                db, "SELECT service_id, date, added FROM service_exception"
            )
            defer { sqlite3_finalize(statement) }
            while sqlite3_step(statement) == SQLITE_ROW {
                let service = sqlite3_column_int(statement, 0)
                exceptions[service, default: [:]][sqlite3_column_int(statement, 1)] =
                    sqlite3_column_int(statement, 2) == 1
            }
        }

        return ServiceCalendar(services: services, exceptions: exceptions)
    }
}
