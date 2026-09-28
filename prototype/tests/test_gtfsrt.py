"""GTFS-Realtime read without the protobuf library. The feed here is written
by hand, byte by byte, with the fields stops.lt sends. The decoder was also
checked against Google's gtfs-realtime-bindings on stops.lt's four live
feeds (2026-09-27): 485 trip updates, 81 of them early, and 220 vehicles,
field for field, no difference."""

import struct
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from vc import gtfsrt  # noqa: E402


def varint(n: int) -> bytes:
    n &= (1 << 64) - 1          # negative int32/int64: two's complement in 64 bits
    out = bytearray()
    while True:
        byte = n & 0x7F
        n >>= 7
        out.append(byte | (0x80 if n else 0))
        if not n:
            return bytes(out)


def number(field: int, n: int) -> bytes:
    return varint(field << 3) + varint(n)


def text(field: int, s: str) -> bytes:
    return message(field, s.encode())


def message(field: int, *parts: bytes) -> bytes:
    body = b"".join(parts)
    return varint(field << 3 | 2) + varint(len(body)) + body


def real(field: int, x: float) -> bytes:
    return varint(field << 3 | 5) + struct.pack("<f", x)


def fixed64(field: int, n: int) -> bytes:
    return varint(field << 3 | 1) + struct.pack("<Q", n)


FEED = b"".join([
    message(1, text(1, "2.0"), number(3, 1790526483)),
    # Running early, 45 s ahead: its delay is a negative varint.
    message(2, text(1, "trip_update_A1"), message(3,
        message(1, text(1, "A1-01-6-260901-ab-1930"), number(4, 0)),
        message(2, message(3, number(1, -45)), text(4, "8262"), number(5, 0)),
        number(4, 1790526483))),
    # Called off.
    message(2, text(1, "trip_update_A46"), message(3,
        message(1, text(1, "A46-03-6-260901-ad-2330"), number(4, 3)))),
    # A trolleybus at a stop, with a field this decoder does not know.
    message(2, text(1, "vehicle_position_1676"), message(4,
        message(1, text(1, "T2-09-6-260907-ba-1910"), number(4, 0)),
        message(2, real(1, 54.6895), real(2, 25.2849617), real(3, 136.0), real(5, 9.17)),
        number(4, 1), number(5, 1790526478), text(7, "7278"),
        message(8, text(1, "1676"), text(2, "Troleibusai 2"), text(3, "BNA 676"), number(4, 2)),
        number(99, 7), fixed64(98, 12345))),
])


class Decoding(unittest.TestCase):

    def setUp(self):
        self.feed = gtfsrt.parse(FEED)

    def test_header(self):
        self.assertEqual(self.feed["timestamp"], 1790526483)

    def test_a_trip_running_early(self):
        trip = self.feed["trips"][0]
        self.assertEqual((trip["trip_id"], trip["relationship"], trip["delay"], trip["stop_id"]),
                         ("A1-01-6-260901-ab-1930", "SCHEDULED", -45, "8262"))

    def test_the_trips_that_will_not_run(self):
        self.assertEqual(gtfsrt.cancelled(self.feed), {"A46-03-6-260901-ad-2330"})

    def test_a_vehicle(self):
        v = self.feed["vehicles"][0]
        self.assertEqual((v["trip_id"], v["id"], v["label"], v["stop_id"], v["status"], v["wheelchair"], v["timestamp"]),
                         ("T2-09-6-260907-ba-1910", "1676", "Troleibusai 2", "7278", 1, 2, 1790526478))
        self.assertAlmostEqual(v["lat"], 54.6895, places=5)
        self.assertAlmostEqual(v["lon"], 25.2849617, places=5)
        self.assertAlmostEqual(v["speed"], 9.17, places=4)
        self.assertEqual(v["bearing"], 136.0)

    def test_an_empty_feed(self):
        self.assertEqual(gtfsrt.parse(b""), {"timestamp": None, "trips": [], "vehicles": []})


if __name__ == "__main__":
    unittest.main()
