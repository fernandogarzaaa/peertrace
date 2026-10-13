# Changelog

## 0.1.1 - 2026-10-13

### Fixed
- `summary` no longer prints an empty `{"events": 0, "status": "running"}` with exit 0 when the run is unreachable; it waits for a replicating peer (`--timeout`, default 15 s) and exits 2 with a clear message if none is found.
- `summary` could race peer discovery and report 0 events even while the writer was online; it now waits for an actual replicating peer before reading.
- Flags can appear before or after the run key (`tail --dir x <key>` used to fail with "expected a 64-char hex run key"); a flag missing its value or an unknown flag is now an error instead of being silently ignored.
- Valid JSON lines without a string `type` are recorded as `error` events with the reason, instead of a generic "unparseable input line".
- Unknown commands print help to stderr and exit 1.

### Added
- `--bootstrap host:port[,...]` to use a private or local DHT.
- CLI tests that run `share` and `summary` end to end over a local DHT testnet.

## 0.1.0 - 2026-10-08
- Initial release: signed append-only Hypercore run logs, `share` / `tail` / `summary` over Hyperswarm.
