export type VehicleStatus = "AVAILABLE" | "CHARGING" | "MAINTENANCE" | "IN_USE" | string;

export interface Vehicle {
  id: string;
  name: string;
  model: string;
  battery_capacity_kwh: number;
  baseline_efficiency_wh_km: number;
  current_soc: number;
  current_soh: number;
  status: VehicleStatus;
}

export interface VehicleCreate {
  id: string;
  name: string;
  model: string;
  battery_capacity_kwh: number;
  baseline_efficiency_wh_km: number;
  current_soc: number;
  current_soh: number;
  status?: VehicleStatus;
}

export interface VehicleUpdate {
  name?: string;
  model?: string;
  battery_capacity_kwh?: number;
  baseline_efficiency_wh_km?: number;
  current_soc?: number;
  current_soh?: number;
  status?: VehicleStatus;
}

export interface VehicleHistoryEntry {
  timestamp: string;
  current_soc: number;
  current_soh: number;
  status: VehicleStatus;
}

export interface TelemetryEvent {
  vehicle_id: string;
  timestamp?: string;
  soc: number;
  soh: number;
  speed_kph: number;
  odometer_km: number;
  ambient_temp_c: number;
  pack_temp_c: number;
  latitude?: number | null;
  longitude?: number | null;
}

export interface TelemetryResponse {
  success: boolean;
  message: string;
  data?: TelemetryEvent | null;
}

export type HvacMode = "OFF" | "LOW" | "MEDIUM" | "HIGH";
export type DrivingStyle = "ECO" | "NORMAL" | "AGGRESSIVE";
export type RegenLevel = "OFF" | "LOW" | "MEDIUM" | "HIGH";
export type RiskLevel = "SAFE" | "CAUTION" | "NOT_RECOMMENDED";

export interface SimulationRequest {
  vehicle_id: string;
  route_distance_km: number;
  elevation_gain_m?: number;
  ambient_temp_c?: number;
  payload_kg?: number;
  hvac_mode?: HvacMode;
  driving_style?: DrivingStyle;
  regen_level?: RegenLevel;
  reserve_soc_target_pct?: number;
}

export interface SimulationResponse {
  vehicle_id: string;
  usable_battery_capacity_kwh: number;
  estimated_energy_consumption_kwh: number;
  projected_arrival_soc_pct: number;
  remaining_range_km: number;
  risk_level: RiskLevel;
  confidence_score_pct: number;
  recommendations: string[];
}
