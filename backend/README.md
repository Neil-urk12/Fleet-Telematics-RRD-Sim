# Fleet API

Run from this directory:

```sh
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Vehicle endpoints and route assessments share a process-local current battery state.
Telemetry ingestion updates SOC/SOH only when its UTC timestamp is at least as new
as the current state. Older readings remain in telemetry history. Equal timestamps
use the last ingested reading. Vehicle specifications and status are preserved.
Timestamps more than five minutes ahead of server UTC time are rejected with 422
before any state or history writes. This applies to single and batch ingestion;
a batch containing an invalid timestamp is rejected in full.

A manual SOC/SOH PATCH stamps the complete battery snapshot with server UTC time.
Only telemetry recorded at or after that time can replace it. A manual edit older
than the existing snapshot (for example, after a future-dated reading) returns 409.
Status/specification-only edits preserve battery provenance. Invalid updates return
422 without changing current state.

Vehicle responses expose `state_source` (`telemetry`, `vehicle_defaults`, `manual`)
and `state_timestamp` (UTC timestamp or null for initial defaults). Simulations also
return `starting_soc_pct` and `starting_soh_pct`, recording the values actually used.
Single, batch, and comparison endpoints share the same state; comparisons hold one
snapshot throughout a run. Saved simulation results retain their original values.

For a registered vehicle without telemetry, `GET /api/telemetry/:id/latest` returns
`data: null`; fleet telemetry includes only reported vehicles. Simulations can still
use the supplied vehicle defaults. Unknown vehicle lookups/ingestion return 404;
batch ingestion reports unknown IDs per item and processes known vehicles. Invalid
batch payloads fail schema validation with 422 before any writes.

Deleting a vehicle clears its current state and vehicle/telemetry histories.
Recreating the ID starts with defaults; previous simulation records remain available.
A vehicle without usable battery capacity produces 422 for single/comparison runs,
or a per-item error in a batch run.

All stores are in memory and are lost on restart. Run one backend process so all
requests see the same stores.

## Verification

```sh
uv run python -m unittest discover -s tests -v
uv run python check_telemetry.py
uv run ruff check
```
