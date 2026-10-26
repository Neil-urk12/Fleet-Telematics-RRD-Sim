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
Each simulation response also includes `vehicle_profile`: the nominal
`battery_capacity_kwh`, `baseline_efficiency_wh_km`, `curb_mass_kg`, and
`regen_efficiency` from the vehicle snapshot used in the calculation.
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

## Local persistence

Vehicles, battery provenance, vehicle/telemetry histories, and saved simulations
persist in SQLite at `backend/data/fleet.sqlite3` by default. Set `DATABASE_PATH`
in the environment or backend `.env` to use another file; relative paths resolve
from the server's working directory. SQLite uses Python's standard library.
The data directory is created on startup and excluded from version control.

The first startup seeds the six demo vehicles. Subsequent startups restore the
saved fleet, including an intentionally empty fleet; deleted vehicles are not
reseeded. Saved simulations remain independent of vehicle deletion/recreation.
The API contracts and battery timestamp ordering rules are unchanged.

Writes commit before the shared in-memory cache changes. Each vehicle change or
telemetry event commits its current state and related history together. Storage
write failures return 503 without applying that change in memory. Batch items and
comparison runs are saved individually; earlier successful writes remain if a
later item fails. Invalid request payloads still fail before any writes.
Unreadable, invalid, or unsupported-version databases fail startup rather than
silently resetting fleet data.

Run **one backend worker** with the default application lifespan enabled: current
state and history are cached in that process. History is loaded into memory on
startup; larger deployments need database-backed queries and pagination.

To back up or move the database, stop the backend and copy the database file.
Keep that file when rolling back code; older versions ignore it and use volatile
memory, so their subsequent changes will not be saved to it. State held only in
an older running server's memory is not automatically imported on upgrade.

## Route energy model

Single, batch, and comparison requests support `elevation_loss_m` (nonnegative total
descent; default `0`) and `road_type` (`URBAN`, `HIGHWAY`, `MIXED`; default `MIXED`).
Vehicle registration and PATCH support `curb_mass_kg` (positive; default `2500`)
and `regen_efficiency` (fraction from `0` to `1`; default `0.60`). Demo fleet masses
vary by vehicle and are illustrative, not verified OEM specifications.

The route-average calculation is:

```text
payload multiplier = 1 + 0.125 × payload kg / curb mass kg
propulsion = baseline Wh/km × road × style × payload multiplier × distance km / 1000
HVAC = selected Wh/km adder × distance km / 1000
climb = (curb mass + payload) × 9.81 × elevation gain / (3,600,000 × 0.80)
recovery per kg = 9.81 × elevation loss / 3,600,000
                  × vehicle regen efficiency × selected regen multiplier
payload demand = loaded propulsion − unloaded propulsion
                 + payload × 9.81 × elevation gain / (3,600,000 × 0.80)
recovery = curb mass × recovery per kg
           + min(payload × recovery per kg, payload demand)
net route energy = propulsion + HVAC + climb − capped recovery
```

## Operational-history overlay

Vehicles may report their operating history: `cycle_count` (equivalent full
cycles), `avg_dod_pct` (average depth of discharge), `fast_charge_share_pct`
(share of charging energy taken from DC fast charging), and
`thermal_stress_index` (0-100). Each is optional; `null` means the history was
not reported, and registration and PATCH accept them like the other vehicle
specifications. The demo fleet carries illustrative values that are not
measured fleet data.

The overlay turns the reported indicators into a 0-100 stress score and a
`NORMAL` / `ELEVATED` / `HIGH` classification, then applies a bounded capacity
factor:

```text
cycle   = min(cycle count / 1500, 1)
DoD     = clamp((average DoD % − 50) / 50, 0, 1)
fast    = min(fast-charge share % / 50, 1)
thermal = thermal stress index / 100
score   = 100 × (0.30·cycle + 0.30·DoD + 0.20·fast + 0.20·thermal)
factor  = 1 − 0.04 × score / 100
```

The factor multiplies the SOH-adjusted capacity, so the available-capacity
chain is nominal capacity → SOH → history → temperature. Unreported indicators
are excluded and the remaining weights are renormalized, so a partially
reported vehicle is not penalized for missing data. A vehicle with no reported
history is not adjusted and is reported as unassessed
(`stress_score` and `stress_class` are `null`). Reported zeros are assessed
normally and are distinct from unreported history.

SOH already reflects a vehicle's accumulated degradation, so this overlay models
the residual stress that SOH does not yet show; that is why its effect is
capped at 4% of usable capacity. The reference points (1500 cycles, a 50%
neutral depth of discharge, a 50% fast-charge share) and the weights are
**heuristic PoC calibration assumptions**, not measured OEM degradation data.
The overlay changes usable capacity, arrival SOC, and remaining range; it does
not change route energy demand, risk thresholds, or the fixed confidence
scores.

Vehicle responses include the derived `battery_history` assessment, and
assessments report the `battery_history` they used along with the history
indicators in `vehicle_profile`. Editing a vehicle's reported history therefore
marks an existing assessment as outdated.

Road multipliers are `URBAN=1.05`, `HIGHWAY=1.15`, `MIXED=1.0`; regen multipliers
are `OFF=0`, `LOW=0.35`, `MEDIUM=0.65`, `HIGH=1.0`. These and the default vehicle
efficiency, climb efficiency, and payload coefficient are **heuristic PoC calibration
assumptions**, not measured performance. Road type only modifies propulsion.
HVAC retains the existing distance-based adders. Defaults preserve the previous
calculation for vehicles that omit the new profile fields.

Recovery requires explicit descent; it does not affect flat routes or model urban
braking. Recovery is capped at gross route demand, so the model cannot predict net
charging on a descent. It does not track segment order, battery headroom, regen power
limits, or a possible battery depletion before a later descent. Those require a
segment model. Arrival SOC may be negative when departure energy is insufficient.

Payload always increases propulsion demand and increases climbing demand when there
is elevation gain. It also increases potential descent recovery through total mass.
The conservative PoC policy caps payload recovery at the payload's added propulsion
and climbing demand, so extra cargo cannot reduce net consumption or improve arrival
SOC or remaining range. For example, at 2000 kg
curb mass, 200 Wh/km, 75 kWh capacity, 80% SOC, 100% SOH, and 0.60 regen efficiency,
a 100 km MIXED/NORMAL route with 1000 m descent, no climb, HIGH regen, HVAC OFF, and
25°C ambient yields 16.73 kWh net demand and 258.6 km remaining range unloaded;
adding 1000 kg retains 16.73 kWh and 258.6 km because its additional recovery is
limited to its 1.25 kWh added demand. Partial payload recovery below that limit still
uses cargo mass. This cap is a decision-support policy rather than a physical claim
about downhill energy recovery. Remaining range extrapolates the assessed route's
net consumption, with the existing 0.05 kWh/km floor; it does not predict range on a
subsequent flat route. Total recovery remains capped at gross demand, so payload
cannot produce net charging.

Results include `propulsion_energy_kwh`, `hvac_energy_kwh`, `climb_energy_kwh`, and
`recovered_regen_energy_kwh` alongside net `estimated_energy_consumption_kwh`.
Components are independently rounded to two decimals, so their displayed sum may
differ slightly from the net total. Existing risk thresholds and fixed confidence
scores remain heuristic. Web and mobile assessment results display the submitted
conditions, reserve, energy breakdown, and all recommendations. Results are marked
outdated when route inputs, the selected vehicle, its reported battery snapshot, or
any captured vehicle specification changes. Offline mobile results capture their
local vehicle profile with the same mass/regen defaults as the backend. Older backend
responses without a profile are treated as outdated because a match cannot be verified.
Confidence is labeled as a fixed heuristic score, not a calibrated probability.

Web assessment results can compare vehicles currently marked `AVAILABLE` using
`POST /api/simulation/batch` with identical submitted conditions. The table sorts by
arrival reserve margin and shows risk, arrival SOC, energy demand, battery provenance
and reading age, and per-vehicle errors. A SAFE alternative to a non-safe assessment
is suggested when its recorded inputs and vehicle state still match. Changed inputs,
battery snapshots, specifications, deletion, or availability mark rows outdated and
disable selection. Select and assess chooses the vehicle and runs a fresh assessment;
it does not dispatch the vehicle or update its operational status. Comparison requires
a backend connection and writes saved runs through the existing batch endpoint.

The web SOC chart and mobile offline estimate still use their own approximations.
The map and SOC chart are labeled as an illustrative Portland–Bend route, separate
from the submitted backend assessment. Mobile offline results identify the omitted
temperature, SOH scaling, road type, descent, regen, and history-stress effects;
they show no energy breakdown or confidence percentage when those are unavailable.

## Verification

Persistence tests use temporary databases and check restarts, timestamp ordering,
deletion/recreation, all simulation modes, and failed-write rollback. They do not
modify the local fleet database.

```sh
uv run python -m unittest discover -s tests -v
uv run python check_telemetry.py
uv run ruff check
```

From the repository root, the standalone shared-client checks are:

```sh
node packages/api-client/check-reading-age.mjs
node packages/api-client/check-fleet-comparison.mjs
node packages/api-client/check-battery-history.mjs
```
