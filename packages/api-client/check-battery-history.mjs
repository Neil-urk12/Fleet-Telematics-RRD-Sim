// Run with: node packages/api-client/check-battery-history.mjs
import assert from "node:assert/strict";
import { formatBatteryHistory, getSimulationVehicleProfile, isAssessmentOutdated } from "./src/simulationResults.ts";

const vehicle = {
  id: "EV-001",
  name: "Alpha",
  model: "Tesla Model 3",
  battery_capacity_kwh: 75,
  baseline_efficiency_wh_km: 160,
  cycle_count: 1610,
  avg_dod_pct: 88,
  fast_charge_share_pct: 58,
  thermal_stress_index: 71,
  current_soc: 80,
  current_soh: 95,
  state_source: "telemetry",
  state_timestamp: "2026-10-10T12:00:00Z",
  status: "AVAILABLE",
};

const request = {
  vehicle_id: "EV-001",
  route_distance_km: 100,
  elevation_gain_m: 0,
  elevation_loss_m: 0,
  road_type: "MIXED",
  ambient_temp_c: 20,
  payload_kg: 0,
  hvac_mode: "OFF",
  driving_style: "NORMAL",
  regen_level: "MEDIUM",
  reserve_soc_target_pct: 15,
};

const profile = getSimulationVehicleProfile(vehicle);
assert.equal(profile.cycle_count, 1610);
assert.equal(profile.avg_dod_pct, 88);
assert.equal(profile.fast_charge_share_pct, 58);
assert.equal(profile.thermal_stress_index, 71);

// Demo vehicles without a reported history fall back to "not reported".
const withoutHistory = getSimulationVehicleProfile({
  ...vehicle,
  cycle_count: undefined,
  avg_dod_pct: undefined,
  fast_charge_share_pct: undefined,
  thermal_stress_index: undefined,
});
assert.equal(withoutHistory.cycle_count, null);
assert.equal(withoutHistory.avg_dod_pct, null);

const assessment = {
  request,
  response: {
    vehicle_id: "EV-001",
    vehicle_profile: profile,
    starting_soc_pct: 80,
    starting_soh_pct: 95,
    state_source: "telemetry",
    state_timestamp: "2026-10-10T12:00:00Z",
    battery_history: { stress_score: 87, stress_class: "HIGH", capacity_factor: 0.9652 },
    usable_battery_capacity_kwh: 72.1,
    estimated_energy_consumption_kwh: 20,
    projected_arrival_soc_pct: 50,
    remaining_range_km: 250,
    risk_level: "SAFE",
    confidence_score_pct: 92,
    recommendations: [],
  },
  origin: "backend",
};

assert.equal(isAssessmentOutdated(assessment, request, vehicle), false);

// A reported history change invalidates the captured assessment.
assert.equal(
  isAssessmentOutdated(assessment, request, { ...vehicle, cycle_count: 1200 }),
  true,
);
assert.equal(
  isAssessmentOutdated(assessment, request, { ...vehicle, thermal_stress_index: 10 }),
  true,
);

// An older response that predates the history fields is not flagged by their absence.
const olderResponse = {
  ...assessment,
  response: {
    ...assessment.response,
    vehicle_profile: {
      battery_capacity_kwh: 75,
      baseline_efficiency_wh_km: 160,
      curb_mass_kg: 2500,
      regen_efficiency: 0.6,
    },
  },
};
assert.equal(
  isAssessmentOutdated(olderResponse, request, {
    ...vehicle,
    cycle_count: undefined,
    avg_dod_pct: undefined,
    fast_charge_share_pct: undefined,
    thermal_stress_index: undefined,
  }),
  false,
);

assert.equal(
  formatBatteryHistory({ stress_score: 87, stress_class: "HIGH", capacity_factor: 0.9652 }),
  "History stress HIGH (87/100)",
);
assert.equal(
  formatBatteryHistory({ stress_score: null, stress_class: null, capacity_factor: 1 }),
  "Operating history not reported",
);
assert.equal(formatBatteryHistory(undefined), "Operating history not reported");

console.log("Battery history checks passed");
