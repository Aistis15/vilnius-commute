"""RAPTOR over the Vilnius timetable, from a point to a point.

A port of Core/Sources/Routing/RaptorRouter.swift, extended the way the app
needs next: the rider starts from a coordinate, not a stop, so the search
starts at every stop within walking reach and ends at every stop from which
the destination can be walked to.

Round k finds the earliest arrival using at most k vehicles, so each round
that improves the arrival yields one option — the natural "fastest" versus
"fewest changes" trade-off the preferences ask for.

Service days work as in the Swift router: a trip at 25:30 belongs to
yesterday's service and runs at 01:30 today, so yesterday is scanned too with
its times shifted back 24 hours.
"""

from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass, field

from .data import Timetable

ORIGIN = -1
DESTINATION = -2
DAY = 86_400
INF = 1 << 60


@dataclass(frozen=True)
class Access:
    stop: int
    metres: int


@dataclass
class Preferences:
    max_transfers: int = 2
    max_walk_metres: int = 800
    walking_speed: float = 1.35     # m/s, an unhurried adult walk
    transfer_buffer: int = 60       # slack demanded at every stop you walk to
    # An extra vehicle has to earn its place. Without this, RAPTOR happily
    # offers "10, then 10 the other way, then 53" to arrive two minutes
    # sooner — correct by the clock, absurd to a person.
    min_gain_per_ride: int = 180

    def walk_seconds(self, metres: int) -> int:
        return math.ceil(metres / self.walking_speed)


@dataclass
class Leg:
    kind: str                       # "walk" or "ride"
    from_stop: int                  # ORIGIN / DESTINATION for the two ends
    to_stop: int
    departure: int                  # seconds from service-day midnight
    arrival: int
    metres: int = 0
    pattern: int = -1
    trip: int = -1
    board_index: int = -1
    alight_index: int = -1
    shift: int = 0


@dataclass
class Journey:
    legs: list[Leg] = field(default_factory=list)

    @property
    def departure(self) -> int:
        return self.legs[0].departure

    @property
    def arrival(self) -> int:
        return self.legs[-1].arrival

    @property
    def rides(self) -> int:
        return sum(1 for leg in self.legs if leg.kind == "ride")

    @property
    def walk_metres(self) -> int:
        return sum(leg.metres for leg in self.legs if leg.kind == "walk")


class Router:
    def __init__(self, timetable: Timetable, preferences: Preferences | None = None):
        self.t = timetable
        self.p = preferences or Preferences()
        self._running_cache: dict[tuple[int, int], list[list[int]]] = {}

    # -- service days ------------------------------------------------------

    def _running(self, date: int, weekday: int) -> list[list[int]]:
        """Per pattern, the trips that run on this service day, in order.

        Cached per day: an arrive-by search runs the router a dozen times on
        the same day, and filtering 20,000 trips each time would dominate.
        """
        key = (date, weekday)
        cached = self._running_cache.get(key)
        if cached is None:
            runs = [self.t.runs(s, date, weekday) for s in range(len(self.t.services))]
            cached = [
                [slot for slot, trip in enumerate(trips) if 0 <= trip[0] < len(runs) and runs[trip[0]]]
                for trips in self.t.pattern_trips
            ]
            self._running_cache[key] = cached
        return cached

    # -- search -------------------------------------------------------------

    def journeys(
        self,
        origins: list[Access],
        destinations: list[Access],
        departing_at: int,
        today: tuple[int, int],
        yesterday: tuple[int, int],
    ) -> list[Journey]:
        """One journey per number of rides that improves on fewer rides."""
        t, p = self.t, self.p
        stop_count = len(t.stop_names)
        best = [INF] * stop_count
        round_best = [INF] * stop_count
        how: list[tuple | None] = [None] * stop_count
        marked: set[int] = set()

        # Every stop within reach is a starting point. No foot transfers are
        # chained onto these walks: they already cover everywhere in reach.
        for access in origins:
            ready = departing_at + p.walk_seconds(access.metres) + p.transfer_buffer
            if ready < round_best[access.stop]:
                best[access.stop] = round_best[access.stop] = ready
                how[access.stop] = ("access", access.metres, departing_at)
                marked.add(access.stop)

        days = ((-DAY, self._running(*yesterday)), (0, self._running(*today)))
        results: list[Journey] = []
        best_arrival = INF

        for _ in range(p.max_transfers + 1):
            if not marked:
                break

            to_scan: dict[int, int] = {}
            for stop in marked:
                for pattern, index in t.patterns_at_stop[stop]:
                    if index < to_scan.get(pattern, INF):
                        to_scan[pattern] = index
            marked = set()

            for pattern, start in to_scan.items():
                for shift, running in days:
                    trips = running[pattern]
                    if trips:
                        self._scan(pattern, start, shift, trips, best, round_best, how, marked)

            self._foot_transfers(marked, round_best, how)
            best = round_best[:]

            # Did this round reach the destination any sooner?
            chosen = None
            threshold = best_arrival if best_arrival == INF else best_arrival - p.min_gain_per_ride
            for access in destinations:
                at_stop = round_best[access.stop]
                if at_stop == INF:
                    continue
                arrival = at_stop + p.walk_seconds(access.metres)
                if arrival <= threshold and (chosen is None or arrival < chosen[1]):
                    chosen = (access, arrival)
            if chosen is not None:
                journey = self._reconstruct(chosen[0], how)
                if journey is not None:
                    results.append(journey)
                    best_arrival = chosen[1]

        return results

    def _scan(self, pattern, start, shift, trips, best, round_best, how, marked):
        t = self.t
        stops = t.pattern_stops[pattern]
        table = t.pattern_trips[pattern]
        current = -1                # position within `trips`, -1 = not on board
        board = 0

        for index in range(start, len(stops)):
            stop = stops[index]

            if current >= 0:
                slot = trips[current]
                arrival = table[slot][1][index] + shift
                if arrival < round_best[stop]:
                    round_best[stop] = arrival
                    how[stop] = ("ride", pattern, slot, board, index, shift)
                    marked.add(stop)

            ready = best[stop]
            if ready == INF:
                continue
            if current >= 0 and ready >= table[trips[current]][2][index] + shift:
                continue            # cannot do better than the trip already held

            # First running trip that leaves this stop no earlier than `ready`.
            # Trips are sorted by departure, and Vilnius vehicles do not
            # overtake one another on a pattern, so a binary search holds.
            position = bisect_left(trips, ready, key=lambda s: table[s][2][index] + shift)
            if position < len(trips) and position != current:
                if current < 0 or position < current:
                    current = position
                    board = index

    def _foot_transfers(self, marked, round_best, how):
        p = self.p
        for stop in list(marked):
            ready = round_best[stop]
            if ready == INF:
                continue
            for target, metres in self.t.transfers[stop]:
                if metres > p.max_walk_metres:
                    continue
                # The buffer is charged on foot transfers: that is where the
                # rider actually risks missing a connection.
                arrival = ready + p.walk_seconds(metres) + p.transfer_buffer
                if arrival < round_best[target]:
                    round_best[target] = arrival
                    how[target] = ("walk", stop, metres, ready)
                    marked.add(target)

    def _reconstruct(self, destination: Access, how) -> Journey | None:
        t, p = self.t, self.p
        legs: list[Leg] = []
        cursor = destination.stop

        for _ in range(64):
            step = how[cursor]
            if step is None:
                return None
            kind = step[0]
            if kind == "access":
                _, metres, departure = step
                legs.append(Leg("walk", ORIGIN, cursor, departure,
                                departure + p.walk_seconds(metres) + p.transfer_buffer, metres))
                break
            if kind == "walk":
                _, source, metres, departure = step
                legs.append(Leg("walk", source, cursor, departure,
                                departure + p.walk_seconds(metres) + p.transfer_buffer, metres))
                cursor = source
            else:
                _, pattern, slot, board, alight, shift = step
                stops = t.pattern_stops[pattern]
                trip = t.pattern_trips[pattern][slot]
                legs.append(Leg("ride", stops[board], cursor, trip[2][board] + shift,
                                trip[1][alight] + shift, pattern=pattern, trip=slot,
                                board_index=board, alight_index=alight, shift=shift))
                cursor = stops[board]
        else:
            return None             # parent pointers loop; refuse rather than spin

        legs.reverse()

        # Leave as late as possible: the walk to the first stop ends one buffer
        # before the vehicle departs, not whenever the search began.
        if len(legs) > 1 and legs[0].kind == "walk" and legs[1].kind == "ride":
            walk = legs[0]
            arrive = legs[1].departure - p.transfer_buffer
            legs[0] = Leg("walk", ORIGIN, walk.to_stop, arrive - p.walk_seconds(walk.metres), arrive, walk.metres)

        last = legs[-1]
        legs.append(Leg("walk", destination.stop, DESTINATION, last.arrival,
                        last.arrival + p.walk_seconds(destination.metres), destination.metres))
        return Journey(legs)
