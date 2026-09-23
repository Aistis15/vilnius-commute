# Data formats

Everything here was read out of the live feed, not assumed. Where it
contradicts the spec, the feed wins and the contradiction is called out.

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

## Live vehicle positions

`https://www.stops.lt/vilnius/gps_full.txt` — **not yet inspected.** No parser
until it has been.
