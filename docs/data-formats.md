# Data formats

Everything here was read out of the live feeds, not assumed. Where it
contradicts the spec, the feed wins and the contradiction is called out.

The schedule database covers five cities. The Vilnius feed is described
first and in the most detail; the other four follow the same format and are
covered in [Other cities](#other-cities-kaunas-klaipėda-šiauliai-panevėžys),
and what the merged database adds is in
[The schedule database](#the-schedule-database).

## Static schedule — GTFS

```
https://www.stops.lt/vilnius/vilnius/gtfs.zip
  Content-Length: 3 698 149
  Last-Modified:  Tue, 22 Sep 2026 18:34:06 GMT
```

Inventoried 2026-09-23 from that snapshot.

### Files present

| File | Rows | Notes |
|---|---:|---|
| `agency.txt` | 1 | single agency |
| `routes.txt` | 115 | |
| `trips.txt` | 21 609 | |
| `stop_times.txt` | 438 013 | the bulk of the archive |
| `stops.txt` | 1 552 | |
| `calendar.txt` | 238 | |
| `calendar_dates.txt` | 2 746 | exceptions |
| `shapes.txt` | — | 6.3 MB of points |
| `areas.txt`, `stop_areas.txt` | 1 / ~40 | fare areas, unused by routing |

**Absent: `transfers.txt`.** Also no `frequencies.txt`. Consequences in
[Routing](#consequences-for-routing).

### Agency

One operator, so `agency_id` carries no routing information:

```
vilnius · SĮ "Susisiekimo paslaugos" · https://www.judu.lt
Europe/Vilnius · lt
```

### Route categories — corrections to the spec

`route_id` has the shape `vilnius_<category>_<name>`. Every category in the
live feed:

| Prefix | Count | `route_type` | `route_color` | `route_text_color` | Names |
|---|---:|---|---|---|---|
| `vilnius_bus` | 82 | 3 | `0073AC` | `FFFFFF` | 1–125, with gaps |
| `vilnius_trol` | 16 | 800 | `DC3131` | `FFFFFF` | 1–21, with gaps |
| `vilnius_expressbus` | 7 | 3 | `008000` | `FFFFFF` | 1G–6G, **3G-A** |
| `vilnius_nightbus` | 9 | 3 | **`000000`** | `FFFFFF` | N1–N9 |
| `vilnius_ferry` | 1 | **4** | **`00A59B`** | `FFFFFF` | L1 |

Three things here differ from the spec's snapshot table:

1. **Night buses are black (`000000`), not blue (`0073AC`).** The spec flagged
   its night-bus row as possibly outdated. It was.
2. **There is a ferry.** `vilnius_ferry`, `route_type` 4, teal `00A59B`, route
   `L1`, 56 trips. The spec's category table had no ferry, and a hardcoded
   four-category enum would have rendered it wrongly or not at all.
3. **Night routes are `N1`–`N9`.** The `N` is a **prefix**, not a suffix.

`route_text_color` is `FFFFFF` for all 115 routes, which does match the spec.

### Route names that were expected and are not there

Checked against the live feed on 2026-09-23:

| Expected by the spec | In the feed |
|---|---|
| `88N`, `101N`–`106N` | **No.** Night service is `N1`–`N9`. |
| Event routes `151R`–`186R` | **No.** |
| Free specials `91`–`94`, `99` | **No.** |

A caveat worth keeping: this is one snapshot of a feed that only publishes
*current* service. Event and seasonal routes plausibly appear in the feed only
while they run, so "not present on 2026-09-23" is not "never exists". That is
exactly why categories must stay data-driven — an unfamiliar prefix has to
render, not crash.

`3G-A` is the longest `route_short_name` at 4 characters. The badge has to fit
it.

### Trips per category

| Category | Trips |
|---|---:|
| `vilnius_bus` | 12 487 |
| `vilnius_trol` | 5 459 |
| `vilnius_expressbus` | 3 295 |
| `vilnius_nightbus` | 312 |
| `vilnius_ferry` | 56 |

### Headers, as they actually are

```
routes.txt      route_id,agency_id,route_short_name,route_long_name,route_desc,
                route_type,route_url,route_color,route_text_color,route_sort_order
trips.txt       route_id,service_id,trip_id,trip_headsign,direction_id,block_id,
                shape_id,wheelchair_accessible,direction_name,bikes_allowed
stop_times.txt  trip_id,arrival_time,departure_time,stop_id,stop_sequence,
                pickup_type,drop_off_type
stops.txt       stop_id,stop_code,stop_name,stop_desc,stop_lat,stop_lon,stop_url,
                location_type,parent_station,platform_code
calendar.txt    service_id,monday,…,sunday,start_date,end_date,info
shapes.txt      shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,shape_dist_traveled
```

`trips.txt` carries a non-standard `direction_name`, and `calendar.txt` a
non-standard `info`. `stop_times.txt` has **no** `timepoint` and no
`shape_dist_traveled`.

## Three traps in this data

### 1. Times run past 24:00:00

The maximum `departure_time` in the feed is **`30:11:00`**. 7 490 rows (1.71%)
are at or after `24:00:00`.

This is standard GTFS — a trip that starts before midnight keeps counting
past it, so a service that departs at 02:11 on Sunday belongs to Saturday's
service day. Parsing these into a wall-clock time type silently loses the
night network, which is precisely the service this app most needs to get
right.

**Times must be stored as seconds from the service day's midnight**, and may
exceed 86 400.

### 2. Stops are completely flat

All 1 552 stops have an empty `location_type`, no `parent_station`, and no
`stop_code`. There is no station grouping at all: the two directions of one
street stop are two unrelated rows.

So "the same stop, other side of the road" has to be inferred from coordinates
and name, not read from the feed.

### 3. No `transfers.txt`

Nothing in the feed says which stops are walkable between, or how long it
takes. Every foot transfer has to be derived.

## Consequences for routing

- Foot transfers must be generated at preprocessing time — pair stops within a
  walking radius, cost them by the user's walking speed — because neither
  `transfers.txt` nor `parent_station` exists to supply them.
- Service days need the calendar plus `calendar_dates` exceptions, and the
  after-midnight rule above, or night buses will be wrong.
- `shapes.txt` is 6.3 MB and is not needed for routing, only for drawing. It
  should not go into the on-device database unless a map view needs it.

## Consequences for the UI

Already actionable, ahead of the badge work:

- `TransitCategory` needs a **ferry** case.
- The night-bus fallback colour must be `000000`, not `0073AC`.
- Sample data using `101N` is wrong; real night routes are `N1`–`N9`.
- The badge must fit 4 characters (`3G-A`) without clipping the number.

## Other cities: Kaunas, Klaipėda, Šiauliai, Panevėžys

stops.lt publishes the same GTFS shape for each at
`https://www.stops.lt/<city>/<city>/gtfs.zip`, served as `application/zip`.
Inventoried 2026-09-26, with the Vilnius feed of the same day for comparison:

| City | `<city>` | Last-Modified | Bytes | Stops | Routes | Trips | Stop times | Latest departure |
|---|---|---|---:|---:|---:|---:|---:|---|
| Vilnius | `vilnius` | Fri, 25 Sep 2026 18:36:14 GMT | 3 573 127 | 1 548 | 115 | 20 846 | 420 413 | 30:11 |
| Kaunas | `kaunas` | Thu, 24 Sep 2026 21:10:30 GMT | 1 841 141 | 966 | 69 | 7 191 | 207 619 | 26:00 |
| Klaipėda | `klaipeda` | Sun, 20 Sep 2026 21:06:31 GMT | 1 255 963 | 928 | 69 | 7 049 | 164 094 | 24:53 |
| Šiauliai | `siauliai` | Mon, 14 Sep 2026 12:42:04 GMT | 587 625 | 471 | 44 | 2 871 | 61 084 | 24:00 |
| Panevėžys | `panevezys` | Mon, 21 Sep 2026 00:00:01 GMT | 339 096 | 252 | 21 | 1 757 | 29 811 | 23:44 |

The three traps below hold in every feed: all stops are flat (empty
`location_type`, no `parent_station`), and **none** ships `transfers.txt` or
`frequencies.txt`. Extra files that routing ignores: Kaunas has
`fare_attributes.txt` and `fare_rules.txt`, Klaipėda `blocks.txt`, Šiauliai
`areas.txt` and `stop_areas.txt`. Kaunas's `routes.txt` has no `agency_id`
column; Klaipėda adds `route_class` and `stops.stop_area`.

### Route ids and categories

`route_id` is always `<city>_<kind>_<name>`, and the name can itself contain
underscores: Klaipėda appends the operator (`klaipeda_bus_M6_TOKS`,
`klaipeda_bus_1_AP`, `klaipeda_bus_1A_Kautra`). The kind is therefore the
**second** token counted from the left; splitting at the last underscore, as
the Vilnius-only build did, would have read `klaipeda_bus_M6` as a kind.

| Prefix | Count | `route_type` | `route_color` | Category |
|---|---:|---|---|---|
| `kaunas_bus` | 54 | 3 | `DC3131` ×53, `0073AC` ×1 | `bus` |
| `kaunas_trol` | 15 | 800 | `008000` | `trolleybus` |
| `klaipeda_bus` | 69 | 3 | `0073AC` ×64, `FF6600` ×4, `008000` ×1 | `bus` |
| `siauliai_bus` | 32 | 3 | `0073AC` | `bus` |
| `siauliai_minibus` | 6 | 3 | `008000` | `bus` |
| `siauliai_regionalbus` | 1 | 3 | `0073AC` | `bus` |
| `siauliai_intercitybus` | 5 | 3 | `800080` | `bus` |
| `panevezys_bus` | 21 | 3 | `0073AC` ×19, `000000` ×2 | `bus` |

- **Colours are per city.** Kaunas buses are red (Vilnius's trolleybus red)
  and its trolleybuses green. Every route in every feed has a colour, so the
  per-category fallback, taken from Vilnius, is never used today.
- Šiauliai's minibus, regional and intercity kinds are all `route_type` 3
  buses, so they map to `bus`; the original kind stays readable in
  `route.gtfs_id`.
- Panevėžys `N1` and `N2` are black but **not** night buses: nothing in that
  feed runs past 23:44. They stay `bus`.
- After-midnight trips outside Vilnius: Kaunas route 29 (379 stop times at or
  past 24:00:00) and a few on 6; Klaipėda M6, 8, M8, 9 and 5; one Šiauliai
  stop time on route 24, at 24:00.

### Ids repeat between feeds

214 `stop_id`s and 79 `trip_id`s exist in more than one feed (stop `5118` is
in Vilnius, Kaunas and Klaipėda). `service_id`s do not collide today. Route
ids never collide because they carry the city.

### Feeds reach beyond their city

Šiauliai's intercity lines end in other cities: route 747 Šiauliai – Vilnius,
751 the express, and 750 Vilnius – Panevėžys – Pakruojis – Šiauliai. So the
Šiauliai feed contains stops called `Vilnius AS`, `Kaunas AS`,
`Devintas fortas` (Kaunas), `Ukmergė AS` and `Panevėžys AS`; its stops span
54.67–56.16°N. Klaipėda's span 55.30–55.97°N, out to Rusnė and Žalgiriai.

## The schedule database

`Tools/gtfs/build_db.py` merges the feeds into one SQLite file, still named
`vilnius.sqlite` and published as `vilnius.sqlite.gz` plus `manifest.json` on
the `data-latest` release, as before. `.github/workflows/gtfs.yml` builds it
from all five feeds:

```
build_db.py --feed vilnius=v.zip --feed kaunas=k.zip --feed klaipeda=kl.zip \
            --feed siauliai=s.zip --feed panevezys=p.zip out/vilnius.sqlite
build_db.py gtfs.zip out/vilnius.sqlite     # the old form: Vilnius alone
```

Every table and column from the Vilnius-only build is unchanged, and
`schema_version` stays **1**: the app refuses any other version outright
(`TimetableLoader.swift`), and it reads columns by name, so additions are
invisible to it. What changed:

- **Dense ids across all feeds**, in the order given (Vilnius first). Checked
  on 2026-09-26: the Vilnius rows of every table are identical to a
  Vilnius-only build, apart from the `gtfs_id` prefix and the transfer fix
  below.
- **`stop.city`** (new, TEXT NOT NULL): `Vilnius`, `Kaunas`, `Klaipėda`,
  `Šiauliai` or `Panevėžys`. It is the feed the stop came from, not the
  municipality: Šiauliai's `Vilnius AS` stop says `Šiauliai`.
- **`gtfs_id` is namespaced** as `<city>:<id>` in `stop`, `service` and
  `trip`, e.g. `vilnius:9483`, because those ids repeat between feeds.
  `route.gtfs_id` stays verbatim. Nothing in the app or prototype reads these.
- **Transfers are derived across feeds**, still purely by distance. Because
  the cities are tens of kilometres apart, the only cross-feed pairs are at
  shared bus stations: 74 directed pairs on 2026-09-26, at Vilnius AS ↔
  Stotis, Kaunas AS and Devintas fortas ↔ Kaunas city stops, and
  Panevėžys AS ↔ Panevėžys city stops. That is what lets an intercity bus
  connect to a city bus.
- **Transfer grid fix.** The grid cell was as many degrees wide as tall, but a
  degree of longitude is only 0.56–0.58 of a degree of latitude here, so pairs
  225–400 m apart east-west could fall two cells apart and be missed. Vilnius
  alone gained 442 directed pairs (258–399 m). A brute-force comparison of all
  stop pairs now matches the table exactly.
- **`meta.cities`** (new): a JSON list, one object per feed in build order —
  `slug`, `name`, `feed_digest` (that zip's sha256, 16 hex digits), `stops`,
  `routes`, `patterns`, `trips`. The manifest copies it as `cities`.
- **`meta.feed_digest`** now covers every feed: the first 16 hex digits of
  the sha256 of one line per feed, `<city> <full sha256 of the zip>\n`, in
  build order. The workflow computes the same value with `sha256sum` before
  building, so it can skip a day on which no feed changed.

Size on 2026-09-26: 4 165 stops, 318 routes, 1 419 patterns, 39 714 trips,
883 021 stop times, 13 754 transfers; 19.4 MB raw and 6.8 MB gzipped (Vilnius
alone was 9.0 MB and 3.3 MB).

`Tools/gtfs/verify_db.py` refuses to publish unless every city is present
above a floor (about 60% of that day's stops, routes and trips), every stop
has a known city, no pattern visits stops of another city than its route's,
the `gtfs_id` namespace agrees with `stop.city`, `meta.cities` matches the
rows, stop and service ids are dense, and no transfer is longer than
`max_transfer_m`, on top of the original night-service and integrity checks.

## Live vehicle positions

`https://www.stops.lt/vilnius/gps_full.txt` — **not yet inspected.** No parser
until it has been.

## Left out: coaches between cities (2026-09-27)

The Šiauliai feed also carries coaches to Vilnius and Kaunas (route ids
`siauliai_intercitybus_*`). The product plans trips inside each of the five
cities, and with those coaches the router offered a seven-hour Kaunas →
Šiauliai → Vilnius trip as a way between cities, so `build_db.py` leaves them
out (`EXCLUDED_KINDS`), together with the 44 stops served only by them. The
merged database then has 4,121 stops, 313 routes, 39,704 trips and no
transfer between cities. A trip whose ends are in different cities is answered
with `cross_city: true` and both city names, so the app can say why.
