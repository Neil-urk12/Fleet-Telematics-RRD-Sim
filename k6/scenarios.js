// k6/scenarios.js
// Shared API scenarios for k6 load tests against the FastAPI backend.
// Override the backend URL with: k6 run -e BASE_URL=http://localhost:8000 ...
import http from 'k6/http';
import { check, sleep } from 'k6';

export const BASE_URL = __ENV.BASE_URL || 'http://127.0.0.1:8000';

// The fleet starts empty, so tests run against whichever vehicles are registered.
export function setup() {
  const vehicleIds = http.get(`${BASE_URL}/api/vehicles/`).json().map((v) => v.id);
  if (vehicleIds.length === 0) {
    throw new Error('No vehicles registered; add at least one before running k6.');
  }
  return { vehicleIds };
}

const HVAC_MODES = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
const DRIVING_STYLES = ['ECO', 'NORMAL', 'AGGRESSIVE'];
const REGEN_LEVELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'];
const RISK_LEVELS = ['SAFE', 'CAUTION', 'NOT_RECOMMENDED'];

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function healthCheck() {
  const res = http.get(`${BASE_URL}/api/health`);
  check(res, {
    'health returns 200': (r) => r.status === 200,
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

export function latestTelemetry(vehicleIds) {
  const vehicleId = pick(vehicleIds);
  const res = http.get(`${BASE_URL}/api/telemetry/${vehicleId}/latest`);
  check(res, {
    'telemetry latest returns 200': (r) => r.status === 200,
  });
  return res;
}

export function runSimulation(vehicleIds) {
  const payload = JSON.stringify({
    vehicle_id: pick(vehicleIds),
    route_distance_km: 40 + Math.floor(Math.random() * 221), // 40-260 km
    elevation_gain_m: Math.floor(Math.random() * 900),
    ambient_temp_c: -10 + Math.round(Math.random() * 500) / 10, // -10..40 °C
    payload_kg: Math.floor(Math.random() * 800),
    hvac_mode: pick(HVAC_MODES),
    driving_style: pick(DRIVING_STYLES),
    regen_level: pick(REGEN_LEVELS),
    reserve_soc_target_pct: 10 + Math.floor(Math.random() * 40), // 10-49 %
  });

  const res = http.post(`${BASE_URL}/api/simulation/run`, payload, {
    headers: JSON_HEADERS,
  });
  check(res, {
    'simulation run returns 200': (r) => r.status === 200,
    'simulation returns a valid risk level': (r) => {
      if (!r.json()) return false;
      return RISK_LEVELS.includes(r.json('risk_level'));
    },
  });
  return res;
}

// Default scenario mix: bias towards the core simulation workload.
export default function ({ vehicleIds }) {
  const roll = Math.random();
  if (roll < 0.6) {
    runSimulation(vehicleIds);
  } else if (roll < 0.8) {
    latestTelemetry(vehicleIds);
  } else if (roll < 0.95) {
    listVehicles();
  } else {
    healthCheck();
  }
  sleep(1);
}
