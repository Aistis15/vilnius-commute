# Data formats

## Status: not yet written — Phase 2

This file is intentionally near-empty. The spec's rule is to inspect the real
data before writing a parser, and nothing has been inspected yet. Filling this
in with a plausible-looking schema would be exactly the failure mode the rule
exists to prevent.

## What is known so far

Only this, from a `HEAD` request made on 2026-09-23:

```
https://www.stops.lt/vilnius/vilnius/gtfs.zip
  HTTP/1.1 200
  Content-Type:   application/zip
  Content-Length: 3698149
  Last-Modified:  Tue, 22 Sep 2026 18:34:06 GMT
  ETag:           "6ab2ca1e-386de5"
```

The feed is live and was refreshed the day before. Its contents have not been
opened.

`https://www.stops.lt/vilnius/gps_full.txt` has not been fetched at all.

## To document in Phase 2

### GTFS static

- [ ] Every file in the archive, and which ones the router needs
- [ ] Every distinct `route_id` prefix, with counts
- [ ] Every distinct `route_type`, including whether 800 (trolleybus) appears
- [ ] Every distinct `route_color` / `route_text_color`, per category
- [ ] Every `agency_id` — the Mobility Database listing suggests more than one,
      so suburban or regional routes may be present
- [ ] Night routes: which of `88N`, `101N`–`106N`, `N1`–`N9` actually exist,
      and how their calendars express "runs at night"
- [ ] Event routes (`151R`–`186R`) and free specials (`91`–`94`, `99`) —
      confirm against the feed rather than against the enthusiast source
- [ ] Whether `transfers.txt` and `shapes.txt` are present and populated

The category list in the spec is **not** to be treated as complete. Categories
must be data-driven: a category that appears in the feed and not in our code
has to render correctly with zero code changes.

### Live positions

- [ ] Actual format of `gps_full.txt` — delimiter, columns, encoding
- [ ] How a row joins to a GTFS trip or route
- [ ] Update frequency, and a polling interval that is polite to the server

### Preprocessing

- [ ] SQLite schema and indexes for the routing queries
- [ ] Where the daily GitHub Action publishes it, and how the app checks for a
      newer copy
