# k6 Performance & Load Testing Suite

This directory contains Grafana k6 performance, stress, spike, endurance, and specialized workload tests for the EV Fleet Telematics and Route Range Degradation Decision Support System backend.

---

## Prerequisites

1. **k6 installed**: verify with `k6 version`.
2. **Backend running**:
   ```bash
   ./start-backend.sh
   # or from backend/: uv run uvicorn app.main:app --port 8000
   ```
3. **At least one registered vehicle**:
   Tests query `GET /api/vehicles/` during `setup()` to discover available vehicle IDs. If the database is completely empty, register a vehicle or seed demo positions:
   ```bash
   uv run python seed_demo_positions.py
   ```

---

## Test Inventory

| Script | Command | Purpose | Profile / Stages | Target Thresholds |
|---|---|---|---|---|
| `smoke-test.js` | `pnpm test:smoke` | Sanity check | 1 VU for 20s | `p(95)<200ms`, 0% errors |
| `load-test.js` | `pnpm test:load` | Baseline load test | Ramp to 50 VUs (1m), hold (3m), ramp down (1m) | `p(95)<200ms`, `errors<1%` |
| `stress-test.js` | `pnpm test:stress` | Capacity limits & breaking point | Stepped ramp: 20 → 50 → 100 → 150 VUs | `p(95)<500ms`, `errors<5%` |
| `spike-test.js` | `pnpm test:spike` | Abrupt surge (e.g. shift dispatch) | 5 VUs → instant spike to 80 VUs → recovery | `p(95)<600ms`, `errors<5%` |
| `soak-test.js` | `pnpm test:soak` | Endurance & leak detection | Sustained 25 VUs for 10 minutes | `p(95)<250ms`, `errors<1%` |
| `telemetry-load.js` | `pnpm test:telemetry` | IoT sensor ingestion | 20 → 40 VUs pushing single & batch telemetry | `p(95)<150ms`, `errors<1%` |
| `batch-simulation-test.js` | `pnpm test:batch-sim` | Heavy compute simulation | 10 → 25 VUs executing multi-vehicle batch & compare runs | `p(95)<350ms`, `errors<2%` |

---

## Usage Examples

### Run against local backend (default `http://127.0.0.1:8000`)
```bash
pnpm test:smoke
pnpm test:load
pnpm test:stress
pnpm test:spike
pnpm test:soak
pnpm test:telemetry
pnpm test:batch-sim
```

### Run directly with `k6` CLI
```bash
k6 run k6/smoke-test.js
k6 run k6/load-test.js
k6 run k6/stress-test.js
k6 run k6/spike-test.js
k6 run k6/soak-test.js
k6 run k6/telemetry-load.js
k6 run k6/batch-simulation-test.js
```

### Override the Target Backend URL
```bash
k6 run -e BASE_URL=http://localhost:8000 k6/load-test.js
k6 run -e BASE_URL=http://192.168.100.63:8000 k6/telemetry-load.js
```

### Export Metrics to JSON or CSV
```bash
k6 run --out json=results-stress.json k6/stress-test.js
k6 run --out csv=results-telemetry.csv k6/telemetry-load.js
```

---

## Modular Scenarios (`scenarios.js`)

`k6/scenarios.js` provides reusable, validated API call functions that can be imported into any custom test script:

- **Fleet & Vehicles**: `listVehicles()`, `getVehicle(vehicleIds)`, `getVehicleHistory(vehicleIds)`
- **Telemetry**: `latestTelemetry(vehicleIds)`, `fleetLatestTelemetry()`, `telemetryHistory(vehicleIds)`, `ingestTelemetry(vehicleIds)`, `ingestBatchTelemetry(vehicleIds)`
- **Simulation**: `runSimulation(vehicleIds)`, `batchSimulation(vehicleIds)`, `compareSimulation(vehicleIds)`, `listSimulationHistory(vehicleIds)`
- **Health**: `healthCheck()`
