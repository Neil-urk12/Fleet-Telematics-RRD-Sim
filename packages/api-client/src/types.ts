export type VehicleStatus = "AVAILABLE" | "CHARGING" | "MAINTENANCE" | "IN_USE" | string;

export type BatteryStateSource = "telemetry" | "vehicle_defaults" | "manual";

export interface BatteryStateMetadata {
  state_source: BatteryStateSource;
  state_timestamp: string | null;
}

export function formatBatteryState(state: BatteryStateMetadata): string {
  const labels: Record<BatteryStateSource, string> = {
    telemetry: "Telemetry",
    vehicle_defaults: "Vehicle defaults",
    manual: "Manual update",
  };
  const label = labels[state.state_source] ?? "Source unavailable";
  return state.state_timestamp
    ? `${label} · ${new Date(state.state_timestamp).toLocaleString()}`
    : label;
}

export interface Vehicle extends BatteryStateMetadata {
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

export interface BatchTelemetryRequest {
  events: TelemetryEvent[];
}

export interface BatchTelemetryResult {
  vehicle_id: string;
  success: boolean;
  message: string;
}

export interface BatchTelemetryResponse {
  results: BatchTelemetryResult[];
}

export interface FleetTelemetryResponse {
  success: boolean;
  message: string;
  data: Record<string, TelemetryEvent>;
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

export interface SimulationResponse extends BatteryStateMetadata {
  vehicle_id: string;
  starting_soc_pct: number;
  starting_soh_pct: number;
  usable_battery_capacity_kwh: number;
  estimated_energy_consumption_kwh: number;
  projected_arrival_soc_pct: number;
  remaining_range_km: number;
  risk_level: RiskLevel;
  confidence_score_pct: number;
  recommendations: string[];
}
