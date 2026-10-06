import type { SimulationRequest, SimulationResponse, SimulationVehicleProfile, Vehicle } from "./types";

/** Client-side snapshot of the inputs and result of one completed assessment. */
export interface SimulationAssessment {
  request: Required<SimulationRequest>;
  response: SimulationResponse;
  origin: "backend" | "local";
}

/** Apply backend defaults for demo vehicles that omit mass and regen efficiency. */
export function getSimulationVehicleProfile(vehicle: Vehicle): SimulationVehicleProfile {
  return {
    battery_capacity_kwh: vehicle.battery_capacity_kwh,
    baseline_efficiency_wh_km: vehicle.baseline_efficiency_wh_km,
    curb_mass_kg: vehicle.curb_mass_kg ?? 2500,
    regen_efficiency: vehicle.regen_efficiency ?? 0.60,
  };
}

export function isAssessmentOutdated(
  assessment: SimulationAssessment,
  currentRequest: Required<SimulationRequest> | null,
  vehicle: Vehicle | undefined,
): boolean {
  if (!currentRequest || !vehicle) return true;
  const inputsChanged = (Object.keys(assessment.request) as (keyof SimulationRequest)[])
    .some(key => assessment.request[key] !== currentRequest[key]);
  const result = assessment.response;
  const profile = result.vehicle_profile;
  const currentProfile = getSimulationVehicleProfile(vehicle);
  // Older backend responses cannot establish whether specifications still match.
  const profileChanged = !profile ||
    (Object.keys(currentProfile) as (keyof SimulationVehicleProfile)[])
      .some(key => profile[key] !== currentProfile[key]);
  return inputsChanged || profileChanged || vehicle.id !== result.vehicle_id ||
    vehicle.current_soc !== result.starting_soc_pct ||
    vehicle.current_soh !== result.starting_soh_pct ||
    vehicle.state_source !== result.state_source ||
    vehicle.state_timestamp !== result.state_timestamp;
}

export function formatSimulationConditions(request: Required<SimulationRequest>): string[] {
  return [
    `${request.route_distance_km} km · Ascent ${request.elevation_gain_m} m · Descent ${request.elevation_loss_m} m · ${request.road_type}`,
    `${request.ambient_temp_c}°C · Payload ${request.payload_kg} kg · Arrival reserve ${request.reserve_soc_target_pct}%`,
    `Driving ${request.driving_style} · HVAC ${request.hvac_mode} · Regen ${request.regen_level}`,
  ];
}

export function getSimulationEnergyBreakdown(result: SimulationResponse) {
  const components = [
    { label: "Propulsion", value: result.propulsion_energy_kwh, recovered: false },
    { label: "HVAC", value: result.hvac_energy_kwh, recovered: false },
    { label: "Climbing", value: result.climb_energy_kwh, recovered: false },
    { label: "Recovered regen", value: result.recovered_regen_energy_kwh, recovered: true },
  ];
  if (components.some(component => typeof component.value !== "number" || !Number.isFinite(component.value))) {
    return null;
  }
  return components as { label: string; value: number; recovered: boolean }[];
}
