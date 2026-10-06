import type { SimulationVehicleProfile, Vehicle } from "./types";

/** Apply backend defaults for demo vehicles that omit mass and regen efficiency. */
export function getSimulationVehicleProfile(vehicle: Vehicle): SimulationVehicleProfile {
  return {
    battery_capacity_kwh: vehicle.battery_capacity_kwh,
    baseline_efficiency_wh_km: vehicle.baseline_efficiency_wh_km,
    curb_mass_kg: vehicle.curb_mass_kg ?? 2500,
    regen_efficiency: vehicle.regen_efficiency ?? 0.60,
  };
}
