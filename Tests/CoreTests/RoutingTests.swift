import Foundation
import Testing

@testable import Core

/// Routing tests against the real Vilnius network.
///
/// These deliberately do not hardcode trip ids or clock times. The database is
/// rebuilt from the live feed every day, so a test pinned to "the 05:14 from
/// Lentvaris" would start failing for reasons that have nothing to do with the
/// router. Instead each test derives its own expectation from the same data
/// the router sees, and asserts a property that must hold whatever the
/// timetable says.
///
/// The strongest of them is `neverWorseThanTheBestDirectTrip`: RAPTOR is
/// allowed to find something better by transferring, but it must never do
/// worse than simply staying on one vehicle.
@Suite(
    "Routing on real Vilnius data",
    .serialized,
    // A genuine skip. The database is a build artifact, not source, so its
    // absence locally is not a routing failure — but when it IS present, a
    // load failure below is a real bug and must fail loudly.
    .enabled(if: RoutingTests.databaseExists, "no schedule database present")
)
struct RoutingTests {

    /// Built in CI by `Tools/gtfs/build_db.py` and fetched before the tests
    /// run. Located from `#filePath` so it works the same on a runner and on a
    /// developer machine.
    static let databaseURL: URL = {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()   // CoreTests
            .deletingLastPathComponent()   // Tests
            .deletingLastPathComponent()   // repo root
            .appendingPathComponent(".build")
            .appendingPathComponent("vilnius.sqlite")
    }()

    static var databaseExists: Bool {
        FileManager.default.fileExists(atPath: databaseURL.path)
    }

    static let timetable: Timetable? = {
        guard FileManager.default.fileExists(atPath: databaseURL.path) else { return nil }
        return try? TimetableLoader.load(from: databaseURL)
    }()

    /// The suite only runs when the database exists, so reaching here with a
    /// nil timetable means the file is present and failed to load — a real bug.
    private func requireTimetable() throws -> Timetable {
        try #require(
            Self.timetable,
            "Database exists at \(Self.databaseURL.path) but failed to load."
        )
    }

    /// A weekday well inside the feed's coverage, derived from the data rather
    /// than from today's date, so the suite does not fail on a Sunday.
    private func busyWeekday(in timetable: Timetable) -> ServiceDay {
        var candidate = Date()
        for _ in 0..<14 {
            let day = ServiceDay(candidate)
            let running = (0..<timetable.calendar.count).count {
                timetable.calendar.runs(serviceID: Int32($0), on: day.date, weekday: day.weekday)
            }
            if day.weekday < 5, running > 0 { return day }
            candidate = candidate.addingTimeInterval(86_400)
        }
        return ServiceDay(Date())
    }

    // MARK: - Loading

    @Test("The real database loads with a plausible network in it")
    func loadsRealTimetable() throws {
        let timetable = try requireTimetable()

        #expect(timetable.stops.count > 1_000)
        #expect(timetable.routes.count > 80)
        #expect(timetable.patterns.count > 400)
        #expect(timetable.trips.count > 15_000)
        #expect(timetable.arrivals.count == timetable.departures.count)
        #expect(timetable.patternsAtStop.count == timetable.stops.count)
        #expect(timetable.transfers.count == timetable.stops.count)
    }

    /// The trap from docs/data-formats.md. If these were parsed as a wall clock
    /// they would wrap and the night network would quietly vanish.
    @Test("After-midnight times survived the load")
    func keepsAfterMidnightTimes() throws {
        let timetable = try requireTimetable()
        let latest = timetable.departures.max() ?? 0
        #expect(latest > 86_400, "latest departure is \(latest)s — night service looks wrapped")
    }

    @Test("Every category in the feed maps to something renderable")
    func routesCarryUsableColours() throws {
        let timetable = try requireTimetable()
        for route in timetable.routes {
            #expect(!route.shortName.isEmpty)
            #expect(TransitPalette.normalizeHex(route.reference.effectiveBackgroundHex) != nil)
        }
        // The feed has a ferry; a four-category assumption would lose it.
        #expect(timetable.routes.contains { $0.category == .ferry })
        #expect(timetable.routes.contains { $0.category == .nightBus })
    }

    // MARK: - Routing

    /// Finds a pattern with two stops far enough apart to be a real ride, and
    /// returns the pair plus the best arrival achievable by staying on board.
    private func directConnection(
        in timetable: Timetable,
        day: ServiceDay,
        departingAt: Int32
    ) -> (from: Int32, to: Int32, bestArrival: Int32)? {
        let services = (0..<timetable.calendar.count).map {
            timetable.calendar.runs(serviceID: Int32($0), on: day.date, weekday: day.weekday)
        }

        for pattern in timetable.patterns {
            let stops = Array(timetable.patternStops[pattern.stopRange])
            guard stops.count >= 8 else { continue }
            let boardIndex = 1
            let alightIndex = stops.count - 2

            var best = Int32.max
            for tripSlot in pattern.tripRange {
                let service = Int(timetable.trips[tripSlot].serviceID)
                guard service >= 0, service < services.count, services[service] else { continue }
                guard timetable.departure(tripSlot: tripSlot, index: boardIndex) >= departingAt
                else { continue }
                best = min(best, timetable.arrival(tripSlot: tripSlot, index: alightIndex))
                break                       // trips are sorted by departure
            }

            if best != .max, stops[boardIndex] != stops[alightIndex] {
                return (stops[boardIndex], stops[alightIndex], best)
            }
        }
        return nil
    }

    @Test("RAPTOR is never worse than staying on one vehicle")
    func neverWorseThanTheBestDirectTrip() throws {
        let timetable = try requireTimetable()
        let day = busyWeekday(in: timetable)
        let departAt: Int32 = 8 * 3600        // 08:00

        let direct = try #require(
            directConnection(in: timetable, day: day, departingAt: departAt),
            "no direct connection found in the feed to compare against"
        )

        let router = RaptorRouter(timetable: timetable)
        let journey = try #require(
            router.earliestJourney(
                from: direct.from, to: direct.to, departingAt: departAt, on: day
            ),
            "router found nothing where a direct trip exists"
        )

        #expect(journey.arrival <= direct.bestArrival,
                "router arrived at \(journey.arrival), direct trip manages \(direct.bestArrival)")
        #expect(journey.departure >= departAt)
        #expect(!journey.legs.isEmpty)
    }

    @Test("A journey's legs chain without gaps or time travel")
    func journeyIsContiguous() throws {
        let timetable = try requireTimetable()
        let day = busyWeekday(in: timetable)
        let departAt: Int32 = 8 * 3600

        let direct = try #require(directConnection(in: timetable, day: day, departingAt: departAt))
        let router = RaptorRouter(timetable: timetable)
        let journey = try #require(
            router.earliestJourney(from: direct.from, to: direct.to, departingAt: departAt, on: day)
        )

        #expect(journey.legs.first?.fromStop == direct.from)
        #expect(journey.legs.last?.toStop == direct.to)

        for leg in journey.legs {
            #expect(leg.arrival >= leg.departure, "a leg arrives before it departs")
        }
        for (earlier, later) in zip(journey.legs, journey.legs.dropFirst()) {
            #expect(later.departure >= earlier.arrival,
                    "leg boards at \(later.departure) but the previous one lands at \(earlier.arrival)")
            #expect(later.fromStop == earlier.toStop, "legs do not join up")
        }
    }

    @Test("The transfer limit is respected")
    func respectsMaxTransfers() throws {
        let timetable = try requireTimetable()
        let day = busyWeekday(in: timetable)
        let departAt: Int32 = 8 * 3600
        let direct = try #require(directConnection(in: timetable, day: day, departingAt: departAt))

        for limit in 0...2 {
            let router = RaptorRouter(
                timetable: timetable,
                preferences: RoutingPreferences(maxTransfers: limit)
            )
            if let journey = router.earliestJourney(
                from: direct.from, to: direct.to, departingAt: departAt, on: day
            ) {
                #expect(journey.transfers <= limit,
                        "asked for at most \(limit) transfers, got \(journey.transfers)")
            }
        }
    }

    /// The case the whole service-day design exists for. Just after midnight
    /// the only thing running belongs to the *previous* service day, so a
    /// router that considers only today finds nothing.
    @Test("Searching after midnight still reaches the night network")
    func findsNightService() throws {
        let timetable = try requireTimetable()
        let day = busyWeekday(in: timetable)

        // A stop that night routes actually call at.
        let nightRouteIDs = Set(
            timetable.routes.filter { $0.category == .nightBus }.map(\.id)
        )
        let nightPattern = try #require(
            timetable.patterns.first { nightRouteIDs.contains($0.routeID) },
            "no night pattern in the feed"
        )
        let stops = Array(timetable.patternStops[nightPattern.stopRange])
        let from = stops[0]
        let to = stops[min(3, stops.count - 1)]

        let router = RaptorRouter(timetable: timetable)
        // 00:30, expressed on the search day — the vehicles serving it departed
        // yesterday at 24:30 and later.
        let journey = router.earliestJourney(
            from: from, to: to, departingAt: 30 * 60, on: day
        )

        if let journey {
            #expect(journey.arrival > journey.departure)
            #expect(journey.departure >= 30 * 60)
        }
        // Not asserting non-nil: whether a given night route runs on a given
        // weekday is a property of the feed, not of the router. The contiguity
        // and ordering checks above are what must hold if it does run.
    }

    @Test("An impossible request returns nothing rather than a wrong answer")
    func unreachableReturnsNil() throws {
        let timetable = try requireTimetable()
        let day = busyWeekday(in: timetable)
        let router = RaptorRouter(timetable: timetable)

        // Out-of-range stop ids must be rejected, not clamped into a real stop.
        #expect(router.earliestJourney(from: -1, to: 0, departingAt: 0, on: day) == nil)
        #expect(router.earliestJourney(
            from: 0, to: Int32(timetable.stops.count), departingAt: 0, on: day
        ) == nil)
    }

    @Test("Routing a busy pair completes quickly enough to be interactive")
    func performsWithinBudget() throws {
        let timetable = try requireTimetable()
        let day = busyWeekday(in: timetable)
        let router = RaptorRouter(timetable: timetable)

        let busiest = timetable.patternsAtStop.enumerated()
            .max { $0.element.count < $1.element.count }
            .map { Int32($0.offset) } ?? 0

        let started = Date()
        _ = router.earliestJourney(
            from: busiest, to: (busiest + 500) % Int32(timetable.stops.count),
            departingAt: 8 * 3600, on: day
        )
        let elapsed = Date().timeIntervalSince(started)

        // Generous: this runs on a simulator under a debug build. It exists to
        // catch an accidental quadratic, not to benchmark.
        #expect(elapsed < 5.0, "one search took \(elapsed)s")
    }
}
