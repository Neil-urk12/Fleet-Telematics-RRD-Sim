import { getSimulationVehicleProfile } from '@fleet/api-client';
import type { Vehicle, TelemetryEvent, SimulationResponse } from '@fleet/api-client';

// ── Mock Vehicles ────────────────────────────────────────────────
export const MOCK_VEHICLES: Vehicle[] = [
    { id: 'EV-001', name: 'Alpha', model: 'Tesla Model 3', battery_capacity_kwh: 75, baseline_efficiency_wh_km: 160, current_soc: 82.4, current_soh: 96.1, state_source: 'vehicle_defaults', state_timestamp: null, status: 'IN_USE' },
    { id: 'EV-002', name: 'Bravo', model: 'Rivian R1T',    battery_capacity_kwh: 135, baseline_efficiency_wh_km: 210, current_soc: 61.8, current_soh: 91.3, state_source: 'vehicle_defaults', state_timestamp: null, status: 'IN_USE' },
    { id: 'EV-003', name: 'Charlie', model: 'Ford F-150L',  battery_capacity_kwh: 98,  baseline_efficiency_wh_km: 240, current_soc: 38.5, current_soh: 88.7, state_source: 'vehicle_defaults', state_timestamp: null, status: 'IN_USE' },
    { id: 'EV-004', name: 'Delta', model: 'Tesla Model Y',  battery_capacity_kwh: 82,  baseline_efficiency_wh_km: 155, current_soc: 91.2, current_soh: 97.4, state_source: 'vehicle_defaults', state_timestamp: null, status: 'CHARGING' },
    { id: 'EV-005', name: 'Echo',  model: 'Chevy Silverado EV', battery_capacity_kwh: 200, baseline_efficiency_wh_km: 280, current_soc: 25.3, current_soh: 84.2, state_source: 'vehicle_defaults', state_timestamp: null, status: 'MAINTENANCE' },
    { id: 'EV-006', name: 'Foxtrot', model: 'Rivian R1S',  battery_capacity_kwh: 135, baseline_efficiency_wh_km: 220, current_soc: 74.6, current_soh: 93.8, state_source: 'vehicle_defaults', state_timestamp: null, status: 'AVAILABLE' },
];

// ── Mock Telemetry ───────────────────────────────────────────────
export const MOCK_TELEMETRY: Record<string, TelemetryEvent> = {
    'EV-001': { vehicle_id: 'EV-001', timestamp: new Date().toISOString(), soc: 82.4, soh: 96.1, speed_kph: 95.2, odometer_km: 24810, ambient_temp_c: 24.5, pack_temp_c: 31.2, latitude: 45.52, longitude: -121.8 },
    'EV-002': { vehicle_id: 'EV-002', timestamp: new Date().toISOString(), soc: 61.8, soh: 91.3, speed_kph: 88.0, odometer_km: 38210, ambient_temp_c: 25.0, pack_temp_c: 35.8, latitude: 45.40, longitude: -121.5 },
    'EV-003': { vehicle_id: 'EV-003', timestamp: new Date().toISOString(), soc: 38.5, soh: 88.7, speed_kph: 72.5, odometer_km: 51400, ambient_temp_c: 23.0, pack_temp_c: 40.4, latitude: 45.28, longitude: -121.2 },
    'EV-004': { vehicle_id: 'EV-004', timestamp: new Date().toISOString(), soc: 91.2, soh: 97.4, speed_kph: 0,    odometer_km: 12300, ambient_temp_c: 22.0, pack_temp_c: 28.1, latitude: 45.52, longitude: -122.6 },
    'EV-005': { vehicle_id: 'EV-005', timestamp: new Date().toISOString(), soc: 25.3, soh: 84.2, speed_kph: 0,    odometer_km: 67890, ambient_temp_c: 26.0, pack_temp_c: 44.7, latitude: 44.05, longitude: -121.3 },
    'EV-006': { vehicle_id: 'EV-006', timestamp: new Date().toISOString(), soc: 74.6, soh: 93.8, speed_kph: 103.4, odometer_km: 19240, ambient_temp_c: 24.0, pack_temp_c: 33.5, latitude: 44.80, longitude: -121.0 },
};

// ── Mock Simulation Result ───────────────────────────────────────
export const MOCK_SIMULATION: SimulationResponse = {
    vehicle_id: 'EV-001',
    vehicle_profile: getSimulationVehicleProfile(MOCK_VEHICLES[0]),
    starting_soc_pct: 82.4,
    starting_soh_pct: 96.1,
    state_source: 'vehicle_defaults',
    state_timestamp: null,
    usable_battery_capacity_kwh: 72.1,
    estimated_energy_consumption_kwh: 24.8,
    projected_arrival_soc_pct: 48.6,
    remaining_range_km: 218,
    risk_level: 'SAFE',
    confidence_score_pct: 91,
    recommendations: ['Charge at Cascade Summit Fast (77.8 km) to ensure comfortable arrival margin.'],
};
