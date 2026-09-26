import Foundation

/// How the rider wants to travel. Every one of these is a user preference in
/// the settings screen, so none of them is hardcoded in the algorithm.
public struct RoutingPreferences: Sendable {
    /// Rides beyond the first. 1 means "one change allowed".
    public var maxTransfers: Int
    /// Furthest the rider will walk in one go, to reach a stop or between them.
    public var maxWalkMetres: Int
    /// 1.35 m/s is an unhurried adult walk, about 4.9 km/h.
    public var walkingSpeed: Double
    /// Slack demanded when changing vehicles, so a 30-second connection is not
    /// offered as if it were comfortable.
    public var transferBuffer: Int

    public init(
        maxTransfers: Int = 2,
        maxWalkMetres: Int = 800,
        walkingSpeed: Double = 1.35,
        transferBuffer: Int = 60
    ) {
        self.maxTransfers = maxTransfers
        self.maxWalkMetres = maxWalkMetres
        self.walkingSpeed = walkingSpeed
        self.transferBuffer = transferBuffer
    }

    public func walkSeconds(metres: Int32) -> Int32 {
        Int32((Double(metres) / walkingSpeed).rounded(.up))
    }
}

/// The calendar day a search runs on.
///
/// Both fields are needed because GTFS service is keyed on a date *and* a
/// weekday, and they are not derivable from one another without a calendar.
public struct ServiceDay: Sendable {
    public let date: Int32      // yyyymmdd
    public let weekday: Int     // 0 = Monday … 6 = Sunday

    public init(date: Int32, weekday: Int) {
        self.date = date
        self.weekday = weekday
    }

    public init(_ date: Date, calendar: Calendar = .current) {
        let parts = calendar.dateComponents([.year, .month, .day, .weekday], from: date)
        self.date = Int32((parts.year ?? 1970) * 10_000 + (parts.month ?? 1) * 100 + (parts.day ?? 1))
        // Foundation counts Sunday as 1; GTFS bitmask counts Monday as 0.
        self.weekday = ((parts.weekday ?? 1) + 5) % 7
    }

    public func previous(calendar: Calendar = .current) -> ServiceDay {
        var parts = DateComponents()
        parts.year = Int(date / 10_000)
        parts.month = Int((date / 100) % 100)
        parts.day = Int(date % 100)
        guard let day = calendar.date(from: parts),
              let yesterday = calendar.date(byAdding: .day, value: -1, to: day)
        else { return self }
        return ServiceDay(yesterday, calendar: calendar)
    }
}

public struct JourneyLeg: Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case walk(metres: Int32)
        case ride(route: RouteRef, headsign: String?, stopCount: Int)
    }

    public let kind: Kind
    public let fromStop: Int32
    public let toStop: Int32
    /// Seconds from the search day's midnight. May exceed 86 400 for service
    /// that runs past midnight.
    public let departure: Int32
    public let arrival: Int32
}

public struct Journey: Sendable, Equatable {
    public let legs: [JourneyLeg]

    public var departure: Int32 { legs.first?.departure ?? 0 }
    public var arrival: Int32 { legs.last?.arrival ?? 0 }
    public var duration: Int32 { arrival - departure }

    /// Vehicle changes, so a single-bus trip is 0.
    public var transfers: Int {
        max(0, legs.filter { if case .ride = $0.kind { true } else { false } }.count - 1)
    }

    public var routes: [RouteRef] {
        legs.compactMap { if case .ride(let route, _, _) = $0.kind { route } else { nil } }
    }
}

/// Round-based public transit routing over the prebuilt timetable.
///
/// RAPTOR works in rounds: round *k* finds the earliest arrival reachable
/// using at most *k* vehicles. That makes "at most N transfers" a natural
/// stopping condition rather than something bolted on afterwards, which is
/// exactly what the preferences ask for.
///
/// ## Service days
///
/// The one thing this must not get wrong. A trip departing at `25:30` belongs
/// to the *previous* day's service and is running at 01:30 this morning. So
/// every search considers two service days — today and yesterday — and shifts
/// yesterday's times back by 24 hours. Search for a 00:30 departure while only
/// considering today, and the entire night network disappears exactly when it
/// is the only thing running.
public struct RaptorRouter: Sendable {

    private let timetable: Timetable
    private let preferences: RoutingPreferences

    public init(timetable: Timetable, preferences: RoutingPreferences = .init()) {
        self.timetable = timetable
        self.preferences = preferences
    }

    private static let secondsPerDay: Int32 = 86_400

    /// How a stop was reached, so a journey can be reconstructed afterwards.
    private enum Arrival {
        case origin
        case walk(from: Int32, metres: Int32, departure: Int32)
        case ride(pattern: Int, tripSlot: Int, boardIndex: Int, alightIndex: Int, dayOffset: Int32)
    }

    /// Earliest arrival at `target`, leaving `origin` no earlier than
    /// `departingAt` (seconds from midnight on `day`).
    public func earliestJourney(
        from origin: Int32,
        to target: Int32,
        departingAt: Int32,
        on day: ServiceDay,
        calendar: Calendar = .current
    ) -> Journey? {
        let stopCount = timetable.stops.count
        guard origin >= 0, Int(origin) < stopCount,
              target >= 0, Int(target) < stopCount
        else { return nil }

        let serviceToday = runningServices(on: day)
        let serviceYesterday = runningServices(on: day.previous(calendar: calendar))

        let infinity = Int32.max
        var best = [Int32](repeating: infinity, count: stopCount)
        var roundBest = [Int32](repeating: infinity, count: stopCount)
        var how = [Arrival?](repeating: nil, count: stopCount)

        best[Int(origin)] = departingAt
        roundBest[Int(origin)] = departingAt
        how[Int(origin)] = .origin

        var marked = Set<Int32>([origin])
        applyFootTransfers(from: &marked, best: &best, roundBest: &roundBest, how: &how)

        // Round 0 is the walk above; each further round adds one vehicle.
        for _ in 0...preferences.maxTransfers {
            guard !marked.isEmpty else { break }

            // Which patterns to scan, and from the earliest useful index.
            var toScan: [Int: Int] = [:]
            for stop in marked {
                for entry in timetable.patternsAtStop[Int(stop)] {
                    let pattern = Int(entry.pattern)
                    let index = Int(entry.index)
                    if let existing = toScan[pattern] {
                        toScan[pattern] = min(existing, index)
                    } else {
                        toScan[pattern] = index
                    }
                }
            }

            marked.removeAll(keepingCapacity: true)

            for (patternSlot, startIndex) in toScan {
                // Yesterday and today are scanned separately: interleaving them
                // would break the monotonic trip order RAPTOR relies on when
                // advancing to an earlier trip.
                for (dayOffset, services) in [(Int32(-1), serviceYesterday), (Int32(0), serviceToday)] {
                    scan(
                        pattern: patternSlot,
                        from: startIndex,
                        dayOffset: dayOffset,
                        services: services,
                        best: &best,
                        roundBest: &roundBest,
                        how: &how,
                        marked: &marked
                    )
                }
            }

            applyFootTransfers(from: &marked, best: &best, roundBest: &roundBest, how: &how)
            best = roundBest
        }

        guard best[Int(target)] != infinity else { return nil }
        return reconstruct(target: target, how: how)
    }

    // MARK: - Rounds

    private func scan(
        pattern patternSlot: Int,
        from startIndex: Int,
        dayOffset: Int32,
        services: [Bool],
        best: inout [Int32],
        roundBest: inout [Int32],
        how: inout [Arrival?],
        marked: inout Set<Int32>
    ) {
        let pattern = timetable.patterns[patternSlot]
        let stopIDs = Array(timetable.patternStops[pattern.stopRange])
        guard startIndex < stopIDs.count else { return }

        let shift = dayOffset * Self.secondsPerDay
        var currentTrip: Int? = nil
        var boardIndex = 0

        for index in startIndex..<stopIDs.count {
            let stop = Int(stopIDs[index])

            if let tripSlot = currentTrip {
                let arrival = timetable.arrival(tripSlot: tripSlot, index: index) + shift
                if arrival < roundBest[stop] {
                    roundBest[stop] = arrival
                    how[stop] = .ride(
                        pattern: patternSlot, tripSlot: tripSlot,
                        boardIndex: boardIndex, alightIndex: index, dayOffset: dayOffset
                    )
                    marked.insert(Int32(stop))
                }
            }

            // Can we board here, or catch something earlier than what we have?
            let readyAt = best[stop]
            guard readyAt != Int32.max else { continue }

            let boardBy = currentTrip.map {
                timetable.departure(tripSlot: $0, index: index) + shift
            }
            if boardBy == nil || readyAt < boardBy! {
                if let earlier = earliestTrip(
                    in: pattern, at: index, notBefore: readyAt,
                    shift: shift, services: services
                ), earlier != currentTrip {
                    currentTrip = earlier
                    boardIndex = index
                }
            }
        }
    }

    /// First trip on this pattern departing `index` at or after `notBefore`.
    ///
    /// A linear scan: patterns hold 31 trips on average, and the trips are
    /// already sorted by departure, so this is cheaper than the bookkeeping a
    /// binary search would need across two service days.
    private func earliestTrip(
        in pattern: Timetable.Pattern,
        at index: Int,
        notBefore: Int32,
        shift: Int32,
        services: [Bool]
    ) -> Int? {
        for tripSlot in pattern.tripRange {
            let service = Int(timetable.trips[tripSlot].serviceID)
            guard service >= 0, service < services.count, services[service] else { continue }
            if timetable.departure(tripSlot: tripSlot, index: index) + shift >= notBefore {
                return tripSlot
            }
        }
        return nil
    }

    private func applyFootTransfers(
        from marked: inout Set<Int32>,
        best: inout [Int32],
        roundBest: inout [Int32],
        how: inout [Arrival?]
    ) {
        for stop in Array(marked) {
            let readyAt = roundBest[Int(stop)]
            guard readyAt != Int32.max else { continue }

            for transfer in timetable.transfers[Int(stop)] {
                guard transfer.metres <= Int32(preferences.maxWalkMetres) else { continue }
                let target = Int(transfer.target)
                guard target >= 0, target < roundBest.count else { continue }

                // The buffer is charged on foot transfers rather than at
                // boarding: that is where the rider actually risks missing a
                // connection.
                let arrival = readyAt
                    + preferences.walkSeconds(metres: transfer.metres)
                    + Int32(preferences.transferBuffer)

                if arrival < roundBest[target] {
                    roundBest[target] = arrival
                    how[target] = .walk(from: stop, metres: transfer.metres, departure: readyAt)
                    marked.insert(transfer.target)
                }
            }
        }
    }

    private func runningServices(on day: ServiceDay) -> [Bool] {
        (0..<timetable.calendar.count).map {
            timetable.calendar.runs(serviceID: Int32($0), on: day.date, weekday: day.weekday)
        }
    }

    // MARK: - Journey reconstruction

    private func reconstruct(target: Int32, how: [Arrival?]) -> Journey? {
        var legs: [JourneyLeg] = []
        var cursor = target

        while let step = how[Int(cursor)] {
            switch step {
            case .origin:
                return Journey(legs: legs.reversed())

            case .walk(let from, let metres, let departure):
                legs.append(JourneyLeg(
                    kind: .walk(metres: metres),
                    fromStop: from,
                    toStop: cursor,
                    departure: departure,
                    arrival: departure + preferences.walkSeconds(metres: metres)
                        + Int32(preferences.transferBuffer)
                ))
                cursor = from

            case .ride(let patternSlot, let tripSlot, let boardIndex, let alightIndex, let dayOffset):
                let pattern = timetable.patterns[patternSlot]
                let stopIDs = Array(timetable.patternStops[pattern.stopRange])
                let shift = dayOffset * Self.secondsPerDay
                let boardStop = stopIDs[boardIndex]

                legs.append(JourneyLeg(
                    kind: .ride(
                        route: timetable.route(of: pattern).reference,
                        headsign: pattern.headsign,
                        stopCount: alightIndex - boardIndex
                    ),
                    fromStop: boardStop,
                    toStop: cursor,
                    departure: timetable.departure(tripSlot: tripSlot, index: boardIndex) + shift,
                    arrival: timetable.arrival(tripSlot: tripSlot, index: alightIndex) + shift
                ))
                cursor = boardStop
            }

            // A cycle would mean the parent pointers are inconsistent; bail
            // rather than spin.
            if legs.count > 32 { return nil }
        }
        return nil
    }
}
