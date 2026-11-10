// k6/scenarios.js
// Shared API scenarios and helpers for k6 load tests against the FastAPI backend.
// Override the backend URL with: k6 run -e BASE_URL=http://localhost:8000 ...
import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8000';

// The fleet starts empty, so tests run against whichever vehicles are registered.
export function setup() {
  const res = http.get(`${BASE_URL}/api/vehicles/`);
  if (res.status !== 200) {
    throw new Error(`Failed to fetch vehicles at ${BASE_URL}/api/vehicles/: status ${res.status}`);
  }
  const body = res.json();
  if (!Array.isArray(body) || body.length === 0) {
    throw new Error('No vehicles registered; add at least one vehicle before running k6.');
  }
  const vehicleIds = body.map((v) => v.id);
  return { vehicleIds };
}

export const HVAC_MODES = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
export const DRIVING_STYLES = ['ECO', 'NORMAL', 'AGGRESSIVE'];
export const REGEN_LEVELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
export const ROAD_TYPES = ['MIXED', 'HIGHWAY', 'URBAN'];
export const RISK_LEVELS = ['SAFE', 'CAUTION', 'NOT_RECOMMENDED'];

export const JSON_HEADERS = { 'Content-Type': 'application/json' };

export function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomFloat(min, max, decimals = 1) {
  const val = Math.random() * (max - min) + min;
  const factor = 10 ** decimals;
  return Math.round(val * factor) / factor;
}

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// -----------------------------------------------------------------------------
// Endpoint Actions
// -----------------------------------------------------------------------------

export function healthCheck() {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'health returns 200': (r) => r.status === 200,
    'health status is ok': (r) => {
      const j = r.json();
      return j && j.status === 'ok';
    },
  });
  return res;
}

export function listVehicles() {
  const res = http.get(`${BASE_URL}/api/vehicles/`);
  check(res, {
    'vehicles list returns 200': (r) => r.status === 200,
    'vehicles list is an array': (r) => Array.isArray(r.json()),
  });
  return res;
}

export function getVehicle(vehicleIds) {
  const vehicleId = pick(vehicleIds);
  const res = http.get(`${BASE_URL}/api/vehicles/${encodeURIComponent(vehicleId)}`);
  check(res, {
    'get vehicle returns 200': (r) => r.status === 200,
    'vehicle id matches': (r) => {
      const j = r.json();
      return j && j.id === vehicleId;
    },
  });
  return res;
}

export function getVehicleHistory(vehicleIds) {
  const vehicleId = pick(vehicleIds);
  const res = http.get(`${BASE_URL}/api/vehicles/${encodeURIComponent(vehicleId)}/history`);
  check(res, {
    'vehicle history returns 200': (r) => r.status === 200,
    'vehicle history is an array': (r) => Array.isArray(r.json()),
  });
  return res;
}

export function latestTelemetry(vehicleIds) {
  const vehicleId = pick(vehicleIds);
  const res = http.get(`${BASE_URL}/api/telemetry/${encodeURIComponent(vehicleId)}/latest`);
  check(res, {
    'telemetry latest returns 200': (r) => r.status === 200,
    'telemetry latest has success': (r) => {
      const j = r.json();
      return j && j.success === true;
    },
  });
  return res;
}

export function fleetLatestTelemetry() {
  const res = http.get(`${BASE_URL}/api/telemetry/fleet/latest`);
  check(res, {
    'fleet telemetry returns 200': (r) => r.status === 200,
    'fleet telemetry has data': (r) => {
      const j = r.json();
      return j && j.success === true && typeof j.data === 'object';
    },
  });
  return res;
}

export function telemetryHistory(vehicleIds) {
  const vehicleId = pick(vehicleIds);
  const res = http.get(`${BASE_URL}/api/telemetry/${encodeURIComponent(vehicleId)}/history`);
  check(res, {
    'telemetry history returns 200': (r) => r.status === 200,
    'telemetry history is an array': (r) => Array.isArray(r.json()),
  });
  return res;
}

export function ingestTelemetry(vehicleIds) {
  const vehicleId = pick(vehicleIds);
  const payload = JSON.stringify({
    vehicle_id: vehicleId,
    soc: randomFloat(20, 95, 1),
    soh: randomFloat(85, 99, 1),
    speed_kph: randomFloat(0, 110, 1),
    odometer_km: randomFloat(1000, 80000, 1),
    ambient_temp_c: randomFloat(15, 38, 1),
    pack_temp_c: randomFloat(20, 42, 1),
    latitude: randomFloat(14.5, 16.4, 4),
    longitude: randomFloat(120.5, 121.0, 4),
  });

  const res = http.post(`${BASE_URL}/api/telemetry/ingest`, payload, {
    headers: JSON_HEADERS,
  });
  check(res, {
    'telemetry ingest returns 200': (r) => r.status === 200,
    'telemetry ingest successful': (r) => {
      const j = r.json();
      return j && j.success === true;
    },
  });
  return res;
}

export function ingestBatchTelemetry(vehicleIds) {
  // Select up to 3 random vehicles for the batch
  const count = Math.min(vehicleIds.length, randomInt(1, 4));
  const shuffled = [...vehicleIds].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);

  const events = selected.map((vid) => ({
    vehicle_id: vid,
    soc: randomFloat(25, 90, 1),
    soh: randomFloat(88, 98, 1),
    speed_kph: randomFloat(10, 90, 1),
    odometer_km: randomFloat(5000, 50000, 1),
    ambient_temp_c: randomFloat(18, 35, 1),
    pack_temp_c: randomFloat(22, 38, 1),
  }));

  const payload = JSON.stringify({ events });
  const res = http.post(`${BASE_URL}/api/telemetry/batch`, payload, {
    headers: JSON_HEADERS,
  });
  check(res, {
    'batch telemetry returns 200': (r) => r.status === 200,
    'batch telemetry results count matches': (r) => {
      const j = r.json();
      return j && Array.isArray(j.results) && j.results.length === count;
    },
  });
  return res;
}

export function runSimulation(vehicleIds) {
  const payload = JSON.stringify({
    vehicle_id: pick(vehicleIds),
    route_distance_km: randomFloat(30, 280, 1),
    elevation_gain_m: randomFloat(50, 1200, 1),
    elevation_loss_m: randomFloat(50, 800, 1),
    road_type: pick(ROAD_TYPES),
    ambient_temp_c: randomFloat(-10, 40, 1),
    payload_kg: randomFloat(0, 1000, 1),
    hvac_mode: pick(HVAC_MODES),
    driving_style: pick(DRIVING_STYLES),
    regen_level: pick(REGEN_LEVELS),
    reserve_soc_target_pct: randomFloat(10, 30, 1),
  });

  const res = http.post(`${BASE_URL}/api/simulation/run`, payload, {
    headers: JSON_HEADERS,
  });
  check(res, {
    'simulation run returns 200': (r) => r.status === 200,
    'simulation returns valid risk level': (r) => {
      const j = r.json();
      return j && RISK_LEVELS.includes(j.risk_level);
    },
    'simulation has remaining range': (r) => {
      const j = r.json();
      return j && typeof j.remaining_range_km === 'number';
    },
  });
  return res;
}

export function batchSimulation(vehicleIds) {
  const count = Math.min(vehicleIds.length, randomInt(1, 3));
  const shuffled = [...vehicleIds].sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, count);

  const payload = JSON.stringify({
    vehicle_ids: selected,
    route_distance_km: randomFloat(50, 200, 1),
    elevation_gain_m: randomFloat(100, 800, 1),
    elevation_loss_m: randomFloat(50, 500, 1),
    road_type: pick(ROAD_TYPES),
    ambient_temp_c: randomFloat(10, 35, 1),
    payload_kg: randomFloat(0, 500, 1),
    hvac_mode: pick(HVAC_MODES),
    driving_style: pick(DRIVING_STYLES),
    regen_level: pick(REGEN_LEVELS),
    reserve_soc_target_pct: 15,
  });

  const res = http.post(`${BASE_URL}/api/simulation/batch`, payload, {
    headers: JSON_HEADERS,
  });
  check(res, {
    'batch simulation returns 200': (r) => r.status === 200,
    'batch simulation has results array': (r) => {
      const j = r.json();
      return j && Array.isArray(j.results);
    },
  });
  return res;
}

export function compareSimulation(vehicleIds) {
  const payload = JSON.stringify({
    vehicle_id: pick(vehicleIds),
    route_distance_km: randomFloat(60, 220, 1),
    elevation_gain_m: randomFloat(100, 900, 1),
    elevation_loss_m: randomFloat(50, 600, 1),
    road_type: pick(ROAD_TYPES),
    ambient_temp_c: randomFloat(15, 32, 1),
    payload_kg: randomFloat(100, 400, 1),
    reserve_soc_target_pct: 15,
    configs: [
      { label: 'Eco Profile', hvac_mode: 'LOW', driving_style: 'ECO', regen_level: 'HIGH' },
      { label: 'Standard Profile', hvac_mode: 'MEDIUM', driving_style: 'NORMAL', regen_level: 'MEDIUM' },
      { label: 'Aggressive Profile', hvac_mode: 'HIGH', driving_style: 'AGGRESSIVE', regen_level: 'LOW' },
    ],
  });

  const res = http.post(`${BASE_URL}/api/simulation/compare`, payload, {
    headers: JSON_HEADERS,
  });
  check(res, {
    'compare simulation returns 200': (r) => r.status === 200,
    'compare returns 3 configuration results': (r) => {
      const j = r.json();
      return j && Array.isArray(j.results) && j.results.length === 3;
    },
  });
  return res;
}

export function listSimulationHistory(vehicleIds) {
  const vehicleId = Math.random() < 0.5 ? pick(vehicleIds) : null;
  const url = vehicleId
    ? `${BASE_URL}/api/simulation/history?vehicle_id=${encodeURIComponent(vehicleId)}`
    : `${BASE_URL}/api/simulation/history`;
  const res = http.get(url);
  check(res, {
    'simulation history returns 200': (r) => r.status === 200,
    'simulation history is an array': (r) => Array.isArray(r.json()),
  });
  return res;
}

// -----------------------------------------------------------------------------
// Default Mixed Scenario
// -----------------------------------------------------------------------------
// Realistic operational traffic mix:
// - 45% Single route simulations
// - 15% Telemetry updates (single or batch ingest)
// - 15% Telemetry queries (latest vehicle or fleet-wide)
// - 10% Batch or comparison simulations
// - 10% Fleet listing / vehicle history
// - 5% Health checks
export default function ({ vehicleIds }) {
  const roll = Math.random();
  if (roll < 0.45) {
    runSimulation(vehicleIds);
  } else if (roll < 0.60) {
    if (Math.random() < 0.6) {
      ingestTelemetry(vehicleIds);
    } else {
      ingestBatchTelemetry(vehicleIds);
    }
  } else if (roll < 0.75) {
    if (Math.random() < 0.5) {
      latestTelemetry(vehicleIds);
    } else {
      fleetLatestTelemetry();
    }
  } else if (roll < 0.85) {
    if (Math.random() < 0.5) {
      batchSimulation(vehicleIds);
    } else {
      compareSimulation(vehicleIds);
    }
  } else if (roll < 0.95) {
    const subRoll = Math.random();
    if (subRoll < 0.4) {
      listVehicles();
    } else if (subRoll < 0.7) {
      getVehicle(vehicleIds);
    } else {
      listSimulationHistory(vehicleIds);
    }
  } else {
    healthCheck();
  }
  sleep(1);
}
