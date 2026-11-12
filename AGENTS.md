# AGENTS.md

## Project Overview

EV Fleet Telematics and Route Range Degradation Decision Support System (school project).
A FastAPI backend assesses electric vehicle route feasibility (SAFE / CAUTION /
NOT_RECOMMENDED). React + TypeScript + Vite provides a fleet dashboard; an Expo mobile
app provides fleet and simulator screens. Both clients are wired to the backend and
display demo/cached data when it is unavailable.

**`Updated-Documentation.md`** is the authoritative design spec (v2.0). Read relevant
sections before implementing features, particularly simulator inputs (§6), the
implementation phases (§21), validation (§23), and acceptance criteria (§26). Its
"Current Complete Web PoC" inventory describes a broader reference PoC; do not assume
every listed capability exists in this repository.

## Repository Layout

- `apps/web/` — React 19 dashboard. `src/App.tsx` holds shared state and renders a
  `Sidebar.tsx` plus hash-routed pages (`#/dashboard` default, `#/vehicles`, `#/garage`,
  `#/planner`, `#/route`, `#/battery`, `#/history`; no router dependency). Vehicles, onboarding and the
  planner also link to `#/garage`. Dashboard: `FleetSummary.tsx` KPI tiles
  and status breakdown, map, fleet list, saved assessments. Vehicles: an "Open garage"
  card (the edit form while editing) and `VehicleActions` (edit, delete with inline
  confirm) beside the fleet list. New vehicles are registered on the dedicated garage page
  (`garage/GaragePage.tsx`, rendered in the page area beside the sidebar; `onCreate` only
  with a live backend; the map and other pages unmount while it is open): its "New vehicle" bay
  swaps the rail to the known-EV catalog (`src/evModels.ts`, approximate published
  specs) with 3D previews built after the fleet (`catalogReady`, `preview()`;
  each catalog model has its own entry in `scene.js` `MODELS`: published dimensions plus a
  hand-placed side profile (`shape()`: hood and roof lines, window edges, pillars), light
  signature, wheels and signature paint, all procedural with no mesh assets; other model
  names fall back to two generic bodies; not exact replicas). Picking a model puts it on
  the lift and supplies model, battery capacity, efficiency and curb mass to the
  `VehicleForm.tsx` add form (`spec` prop; regen keeps its 0.60 default); the form
  only asks for ID (read-only, assigned as the next free one, e.g. `EV-007`; shown because
  telemetry reports under it), name, status, SOC and SOH. The edit form keeps every spec editable.
  A created car is built with `garage.add()` in its preview's paint and raised on the
  lift without rebuilding the scene. Edits PATCH only the fields changed since editing began, so
  untouched SOC/SOH never overwrite newer telemetry or switch its provenance to manual. With an empty live fleet the
  dashboard keeps its layout: KPI tiles show dashed placeholders, the route map stays,
  and `FleetOnboarding` (in `FleetSummary.tsx`) lists the first-vehicle steps and navigates
  to `#/garage`. Planner, route and
  battery show a generic "add a vehicle" empty state. Planner: route form, result, history.
  Under a result, `FleetComparison.tsx` compares available vehicles (batch) and
  `ScenarioComparison.tsx` compares driving/HVAC/regen setups for the assessed vehicle
  (`POST /api/simulation/compare`: the submitted setup plus fixed presets; each setup is
  saved as an assessment; "Use this setup" only fills the form).
  Route: playback controls, map, elevation/SOC, charging. A current planner result on the
  Manila → Baguio route (exact preset distance/ascent/descent) is replayed there: Simulate trip
  opens `#/route` and plays it, and the SOC curve keeps the backend's start and arrival SOC,
  spread by the local estimate's cumulative energy. Battery: thermal, SOH history, regen
  (`RegenBrakingPanel.tsx` shows the current planner result's recovered regen energy). `BatteryHealthChart.tsx` plots the selected vehicle's recorded SOH from
  `GET /api/vehicles/{id}/history`, reloading when its battery state timestamp changes; the
  fixed `EV-001`–`EV-006` example curves appear only in offline demo mode, labelled
  illustrative. Playback only animates on the route and battery pages.
  `src/components/RouteInputs.tsx` is the guided setup form (vehicle, numeric route
  fields, road type, driving/HVAC/regen, submit); `ControlsBar.tsx` drives the route
  preview playback.
  `src/hooks/useFleetData.ts` polls vehicles/telemetry and runs simulations through
  the shared client. `AssessmentHistory.tsx` lists the selected vehicle's 10 newest saved
  backend assessments (including fleet-comparison batch runs) and reloads after each single
  or batch run; it shows an "unavailable" alert when the backend is unreachable. `#/history`
  shows the same table without the 10-row limit. Clicking a row (or its date link) opens `#/history/<id>`
  (`AssessmentDetail.tsx`, loaded with `GET /api/simulation/{record_id}`): the full saved
  result, its own map and SOC-chart replay from the saved result (Manila → Baguio runs only,
  independent of the vehicle's current state), and "Rerun with these inputs", which loads the
  saved request into the planner form and runs it against the vehicle's current battery
  state as a new saved run. `src/mockData.ts` supplies demo data. `src/routeData.ts` is the
  generated Manila → Baguio dataset (do not edit by hand) that feeds the Leaflet map in
  `MapPanel.tsx`, the elevation chart, the example trip, and the sample charging stations.
- `apps/mobile/` — React Native / Expo SDK 57. `App.tsx` handles backend access and an
  offline simulation approximation; `src/screens/` contains dashboard, fleet,
  simulator, alerts, and more screens. Read `apps/mobile/AGENTS.md` before editing.
- `packages/api-client/` — Shared TypeScript types, typed HTTP client, and numeric
  route-input parsing/validation in `src/`. `check-*.mjs` are standalone
  `node:assert` checks for the shared client (reading age, fleet comparison, battery
  history, saved-assessment history, setup comparison), run via `pnpm test:client`.
- `backend/` — FastAPI, Python 3.11, managed with `uv`.
  - `app/main.py` — CORS and routers under `/api/{vehicles,telemetry,simulation}`;
    `/api/health` health check.
  - `app/api/` — vehicle CRUD/history, telemetry single/batch ingestion and history,
    simulation single/batch/comparison and saved-run history.
  - `app/core/fleet_state.py` — shared, locked, process-local vehicle and telemetry
    stores; battery state ordering and provenance.
  - `app/core/persistence.py` — SQLite or Turso storage for vehicles, vehicle/telemetry history,
    and saved simulations; writes commit before changing the process-local caches.
  - `app/core/simulator.py` — `calculate_simulation(req, vehicle)` and route-energy
    calibration coefficients.
  - `app/core/battery_history.py` — operational-history stress overlay and its
    calibration coefficients.
  - `app/schemas/` — Pydantic v2 validation and request/response models.
  - `tests/` — standard-library unittest coverage for current state, route energy,
    and the history overlay.
- `k6/` — smoke, load, stress, spike, soak, telemetry, and batch simulation scripts.
- `apps/web/vite.config.ts` — `/api` proxy to `http://127.0.0.1:8000`.

## Commands

Root (pnpm workspace):

- `pnpm dev:web` — Vite web server, normally port 5173.
- `pnpm dev:mobile` — Expo development server.
- `pnpm build:web` — TypeScript checks and Vite production build.
- `pnpm lint` — oxlint on the web app.
- `pnpm --filter @fleet/mobile exec tsc --noEmit` — mobile TypeScript check.
- `pnpm --filter @fleet/mobile android` / `ios` / `web` — targeted Expo startup.
- `pnpm test:smoke` / `pnpm test:load` / `pnpm test:stress` / `pnpm test:spike` / `pnpm test:soak` / `pnpm test:telemetry` / `pnpm test:batch-sim` — k6 performance checks (requires k6 and a running backend).
- `pnpm test:client` — standalone shared-client checks (no backend or browser needed).
- `node apps/web/scripts/build-route-data.mjs` — regenerate `routeData.ts` from public
  OSRM and OpenTopoData services (manual, one-off); `--check [file]` validates it offline.
- `node apps/web/scripts/check-garage-models.mjs` — checks that every catalog EV in
  `evModels.ts` has its own garage body in `scene.js` `MODELS` (no backend or browser needed).

From `backend/`:

- `uv sync` — install dependencies, including httpx and ruff in the dev group.
- `uv run uvicorn app.main:app --reload --port 8000` — development API. Run from
  `backend/` so absolute `app.*` imports resolve; port 8000 matches the web proxy.
- `uv run python -m unittest discover -s tests -v` — backend tests; no pytest needed.
- `uv run python check_telemetry.py` — telemetry integration check; inspect the script
  for its running-server requirements.
- `uv run python seed_demo_positions.py [--base-url URL]` — opt-in: posts one telemetry
  batch placing every registered vehicle on the Manila → Baguio corridor. Keeps current
  SOC/SOH but switches battery provenance to telemetry. Needs a running backend.
- `uv run ruff check` / `uv run ruff format` — Python lint/format, line length 100,
  double quotes, rules E/W/F/I/B/UP.

There is no frontend test runner or CI configured. Do not invent test commands.
`numpy` and `pandas` are declared dependencies but unused by the simulator.

## Architecture & Data Flow

Both apps use `@fleet/api-client`. Web API location comes from `VITE_API_URL`, falling
back to `http://localhost:8000`; mobile configuration lives in `src/config/api.ts`.
The Vite proxy also supports relative `/api` requests.

Telemetry ingestion → `fleet_state` current battery snapshot → vehicle endpoints and
single/batch/comparison simulation → `calculate_simulation()` → response and saved run.

- SOC/SOH updates share one current-state store. Newer telemetry wins; equal
  timestamps use the last ingested event; older events remain in history.
- Manual SOC/SOH PATCH stamps the complete battery snapshot with server UTC time.
  Edits older than an existing snapshot return 409. Specification/status edits
  preserve battery provenance.
- Vehicle and simulation responses expose `state_source` and `state_timestamp`;
  simulations record `starting_soc_pct` and `starting_soh_pct` actually used.
- Vehicle responses also expose the derived `battery_history` assessment.
  Assessments record the history indicators they used in `vehicle_profile`, so
  editing a vehicle's reported history marks an existing assessment outdated.
- Unreported vehicles return `data: null` from latest telemetry. There is no synthetic
  live telemetry fallback. Simulations can use the registered vehicle defaults.
- Telemetry over five minutes in the future is rejected with 422. Invalid batch
  payloads fail validation before writes; unknown IDs are reported per batch item.
- Deleting a vehicle clears its vehicle/telemetry state and history. Saved simulation
  records retain their original values even if the ID is recreated.
- Stores persist in SQLite (`backend/data/fleet.sqlite3`, configurable with
  `DATABASE_PATH`), or in Turso when `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are
  set (via `libsql`; its cursors are not iterable, so call `.fetchall()`), and load
  into memory at application startup. A new database starts with no vehicles; they are
  registered through `POST /api/vehicles`. The `MOCK_FLEET` demo vehicles only exist
  in-process when no database is open (tests, `check_telemetry.py`). Run one backend process with lifespan enabled so requests
  share the caches. Tests without lifespan use isolated in-memory state; persistence
  tests use temporary databases. No auth or schema upgrade migrations are implemented.

## Simulator Behavior

Inputs include distance, ascent (`elevation_gain_m`), descent (`elevation_loss_m`), road
type, ambient temperature, payload, driving style, HVAC, regen, and reserve (0–50%).
Vehicle profiles include positive `curb_mass_kg` (default 2500),
`regen_efficiency` (0–1, default 0.60), and optional reported operating history:
`cycle_count`, `avg_dod_pct`, `fast_charge_share_pct`, `thermal_stress_index`.

- SOH scales nominal capacity. Temperature factors: <0°C 0.80, <15°C 0.90,
  >35°C 0.95, otherwise 1.0.
- The history overlay sits between SOH and temperature in the capacity chain. It
  scores the reported indicators into a 0–100 stress score and a NORMAL /
  ELEVATED / HIGH class, then applies a factor of `1 − 0.04 × score / 100`.
  Unreported indicators are excluded and the remaining weights renormalized; a
  vehicle with no reported history is not adjusted and reports a null score and
  class. Reported zeros are assessed normally.
- Propulsion uses road (URBAN 1.05 / HIGHWAY 1.15 / MIXED 1.0), style (ECO 0.88 /
  NORMAL 1.0 / AGGRESSIVE 1.25), and payload (`1 + 0.125 × payload / curb mass`).
- HVAC adds OFF 0 / LOW 15 / MEDIUM 30 / HIGH 55 Wh/km, independently of road type.
- Climbing uses curb mass + payload and 80% efficiency. Descent recovery uses vehicle
  regen efficiency and OFF 0 / LOW 0.35 / MEDIUM 0.65 / HIGH 1.0.
- Regen requires explicit descent; it does not model urban braking. Recovery is
  capped at gross route demand, and payload recovery at the payload's added propulsion
  and climbing demand: increasing payload cannot improve arrival SOC or range.
- Results include propulsion, HVAC, climb, and recovered regen energy. Components
  are rounded independently; displayed sums can differ slightly from net energy.
- Arrival SOC may be negative. Remaining range extrapolates route consumption with
  a 0.05 kWh/km floor. Zero usable battery capacity produces 422 (per-item batch error).
- Arrival SOC ≥ reserve → SAFE; ≥ reserve / 2 → CAUTION; otherwise NOT_RECOMMENDED.
- `uncertainty_pct` is ±5% of route energy plus 5 (<0°C) / 3 (>35°C) / 4 (AGGRESSIVE) /
  2 (URBAN) / 2 or 4 (ELEVATED or HIGH stress) / 3 (SOH <80%). It sets the predicted
  range and arrival SOC low/high bands. `confidence_score_pct` is the normal-CDF chance
  of arriving at or above the reserve (band = 90% interval; 50 at exactly the reserve).
  Band fields are nullable for older saved runs. Recommendations and confidence remain heuristic.

These are PoC calibration assumptions, not measured OEM performance. No segment-order,
battery headroom, or regen power-limit model is implemented. Calibrated uncertainty
is still a design target.

## UI Boundaries & Gotchas

- The web map shows the real Manila → Baguio road via Marcos Highway (282.8 km, from
  `routeData.ts`; Agoo and Tubao are forced as vias so OSRM avoids the Rosario–Pugo
  shortcut and Kennon Road) on OpenStreetMap tiles darkened with CSS; no API key. OSM's tile
  usage policy allows light use with attribution only. The app makes no routing or
  elevation calls at runtime, and the route, markers and stations still render without tiles.
- Vehicles appear at their latest telemetry latitude/longitude; vehicles without one
  are listed as "No position reported". Playback moves only the route-preview marker
  and the chart indicator, never vehicles. Charging stations are generic samples with
  illustrative availability, labelled SAMPLE.
- The map pans to a selected vehicle or station only when it is off-screen (never for
  playback or telemetry updates). Clicking the route sets the preview to the nearest
  point on it. Keys pressed while the map has focus belong to Leaflet; the global
  shortcuts in `App.tsx` ignore them.
- The elevation/SOC chart and mobile offline simulation use approximations distinct
  from the backend. Mobile offline estimates exclude temperature, road type, descent, regen,
  and history stress. Keep demo/cached/local estimates visibly identified.
- Route assessment inputs must be explicit and editable, and sent through the shared
  `SimulationRequest` contract. Keep negative temperatures valid, distance positive,
  ascent/descent/payload nonnegative, and reserve within 0–50%; reject blank/nonfinite
  numeric inputs before submission.
- Reuse shared driving/HVAC/regen/road enums; HVAC and regen both support
  OFF / LOW / MEDIUM / HIGH.
- Vehicle IDs are user-defined; k6 scripts read the registered fleet in `setup()` and
  need at least one vehicle. In-process demo IDs run `EV-001`–`EV-006`; mobile offline
  demo IDs differ.
  404 messages quote the unknown ID.
- Model new timestamps on `datetime.now(UTC)`. `.zed/settings.json` uses ruff and
  pyright, with formatting/import sorting enabled on save.
- Root README still contains Vite template text; `backend/README.md` documents current
  battery-state and energy behavior, assumptions, and verification.
