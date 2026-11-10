import type { SimulationRequest } from "./types";

export type SimulationNumericParameters = Required<Pick<SimulationRequest,
  | "route_distance_km"
  | "elevation_gain_m"
  | "elevation_loss_m"
  | "ambient_temp_c"
  | "payload_kg"
  | "reserve_soc_target_pct"
>>;

export type SimulationNumericDraft = Record<keyof SimulationNumericParameters, string>;

interface NumericField {
  key: keyof SimulationNumericParameters;
  label: string;
  min?: number;
  max?: number;
  exclusiveMin?: boolean;
}

// Match the backend contract; negative ambient temperatures are valid.
export const simulationNumericFields: readonly NumericField[] = [
  { key: "route_distance_km", label: "Distance (km)", min: 0, exclusiveMin: true },
  { key: "elevation_gain_m", label: "Ascent (m)", min: 0 },
  { key: "elevation_loss_m", label: "Descent (m)", min: 0 },
  { key: "ambient_temp_c", label: "Temperature (°C)" },
  { key: "payload_kg", label: "Payload (kg)", min: 0 },
  { key: "reserve_soc_target_pct", label: "Arrival reserve (%)", min: 0, max: 50 },
];

export function parseSimulationInputs(draft: SimulationNumericDraft) {
  const values = {} as SimulationNumericParameters;
  const errors: Partial<Record<keyof SimulationNumericParameters, string>> = {};

  for (const field of simulationNumericFields) {
    const raw = draft[field.key].trim();
    const value = Number(raw);
    values[field.key] = value;
    if (!raw || !Number.isFinite(value)) {
      errors[field.key] = "Enter a finite number.";
    } else if (field.min !== undefined &&
      (field.exclusiveMin ? value <= field.min : value < field.min)) {
      errors[field.key] = field.exclusiveMin
        ? `Must be greater than ${field.min}.`
        : `Must be at least ${field.min}.`;
    } else if (field.max !== undefined && value > field.max) {
      errors[field.key] = `Must be ${field.max} or less.`;
    }
  }

  return { parameters: Object.keys(errors).length ? null : values, errors };
}
