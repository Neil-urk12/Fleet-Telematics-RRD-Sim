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

- `apps/web/` — React 19 dashboard. `src/App.tsx` composes the controls, fleet/map,
  elevation/SOC, thermal, battery-health, regen, and charging panels.
  `src/components/RouteInputs.tsx` contains editable numeric route fields and road type;
  `ControlsBar.tsx` supplies driving/HVAC/regen and submits the assessment form.
  `src/hooks/useFleetData.ts` polls vehicles/telemetry and runs simulations through
  the shared client. `src/mockData.ts` supplies demo data.
- `apps/mobile/` — React Native / Expo SDK 57. `App.tsx` handles backend access and an
  offline simulation approximation; `src/screens/` contains dashboard, fleet,
  simulator, alerts, and more screens. Read `apps/mobile/AGENTS.md` before editing.
- `packages/api-client/` — Shared TypeScript types, typed HTTP client, and numeric
  route-input parsing/validation in `src/`.
- `backend/` — FastAPI, Python 3.11, managed with `uv`.
  - `app/main.py` — CORS and routers under `/api/{vehicles,telemetry,simulation}`;
    `/api/health` health check.
  - `app/api/` — vehicle CRUD/history, telemetry single/batch ingestion and history,
    simulation single/batch/comparison and saved-run history.
  - `app/core/fleet_state.py` — shared, locked, process-local vehicle and telemetry
    stores; battery state ordering and provenance.
  - `app/core/simulator.py` — `calculate_simulation(req, vehicle)` and route-energy
    calibration coefficients.
  - `app/schemas/` — Pydantic v2 validation and request/response models.
  - `tests/` — standard-library unittest coverage for current state and route energy.
- `k6/` — smoke/load scripts.
- `apps/web/vite.config.ts` — `/api` proxy to `http://127.0.0.1:8000`.

## Commands

Root (pnpm workspace):

- `pnpm dev:web` — Vite web server, normally port 5173.
- `pnpm dev:mobile` — Expo development server.
- `pnpm build:web` — TypeScript checks and Vite production build.
- `pnpm lint` — oxlint on the web app.
- `pnpm --filter @fleet/mobile exec tsc --noEmit` — mobile TypeScript check.
- `pnpm --filter @fleet/mobile android` / `ios` / `web` — targeted Expo startup.
- `pnpm test:smoke` / `pnpm test:load` — k6 checks (requires k6 and a running backend).

From `backend/`:

- `uv sync` — install dependencies, including httpx and ruff in the dev group.
- `uv run uvicorn app.main:app --reload --port 8000` — development API. Run from
  `backend/` so absolute `app.*` imports resolve; port 8000 matches the web proxy.
- `uv run python -m unittest discover -s tests -v` — backend tests; no pytest needed.
- `uv run python check_telemetry.py` — telemetry integration check; inspect the script
  for its running-server requirements.
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
- Unreported vehicles return `data: null` from latest telemetry. There is no synthetic
  live telemetry fallback. Simulations can use the registered vehicle defaults.
- Telemetry over five minutes in the future is rejected with 422. Invalid batch
  payloads fail validation before writes; unknown IDs are reported per batch item.
- Deleting a vehicle clears its vehicle/telemetry state and history. Saved simulation
  records retain their original values even if the ID is recreated.
- All stores are in memory and lost on restart. Run one backend process so requests
  share state. No auth, database, or migrations are implemented.

## Simulator Behavior

Inputs include distance, ascent (`elevation_gain_m`), descent (`elevation_loss_m`), road
type, ambient temperature, payload, driving style, HVAC, regen, and reserve (0–50%).
Vehicle profiles include positive `curb_mass_kg` (default 2500) and
`regen_efficiency` (0–1, default 0.60).

- SOH scales nominal capacity. Temperature factors: <0°C 0.80, <15°C 0.90,
  >35°C 0.95, otherwise 1.0.
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
- Arrival SOC ≥ reserve → SAFE (fixed confidence 92); ≥ reserve / 2 → CAUTION (75);
  otherwise NOT_RECOMMENDED (88). Recommendations and confidence remain heuristic.

These are PoC calibration assumptions, not measured OEM performance. No segment-order,
battery headroom, or regen power-limit model is implemented. History stress and
calibrated uncertainty are still design targets.

## UI Boundaries & Gotchas

- Web map playback and its elevation/SOC chart use a fixed illustrative Portland–Bend
  route. The chart and mobile offline simulation use approximations distinct from the
  backend. Mobile offline estimates exclude temperature, road type, descent, and regen.
  Keep demo/cached/local estimates visibly identified.
- Route assessment inputs must be explicit and editable, and sent through the shared
  `SimulationRequest` contract. Keep negative temperatures valid, distance positive,
  ascent/descent/payload nonnegative, and reserve within 0–50%; reject blank/nonfinite
  numeric inputs before submission.
- Reuse shared driving/HVAC/regen/road enums; HVAC and regen both support
  OFF / LOW / MEDIUM / HIGH.
- Backend demo IDs run from `EV-001` through `EV-006`; mobile offline demo IDs differ.
  404 messages quote the unknown ID.
- Model new timestamps on `datetime.now(UTC)`. `.zed/settings.json` uses ruff and
  pyright, with formatting/import sorting enabled on save.
- Root README still contains Vite template text; `backend/README.md` documents current
  battery-state and energy behavior, assumptions, and verification.
