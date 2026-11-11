import React, { useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { formatBatteryState } from "@fleet/api-client";
import type { Vehicle, VehicleCreate } from "@fleet/api-client";
import { colors } from "../constants/theme";
import { EV_MODELS, bodyLabel, formatEvSpecs } from "../evModels";
import type { EvModel } from "../evModels";

interface GarageScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  dataStatus: "demo" | "live" | "cached";
  onSelectVehicle: (vehicle: Vehicle) => void;
  onCreate?: (payload: VehicleCreate) => Promise<Vehicle>;
}

const STATUSES = ["AVAILABLE", "IN_USE", "CHARGING", "MAINTENANCE"];
const pad = (n: number) => String(n).padStart(2, "0");

export const GarageScreen: React.FC<GarageScreenProps> = ({
  vehicles,
  selectedVehicle,
  dataStatus,
  onSelectVehicle,
  onCreate,
}) => {
  const [adding, setAdding] = useState(false);
  const [pick, setPick] = useState<number | null>(null);
  const showForm = !!onCreate && (adding || vehicles.length === 0);
  const index = Math.max(0, vehicles.findIndex((vehicle) => vehicle.id === selectedVehicle?.id));
  const vehicle = vehicles[index] ?? null;
  const spec = pick === null ? null : EV_MODELS[pick];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Fleet garage</Text>
          <Text style={styles.subtitle}>
            {showForm
              ? `Register a vehicle · ${EV_MODELS.length} models`
              : `${onCreate ? "Choose or add a vehicle" : "Choose a vehicle"} · ${vehicles.length} bays`}
          </Text>
        </View>
        <Text style={styles.counter}>
          {showForm
            ? `${pad(pick === null ? 0 : pick + 1)} / ${pad(EV_MODELS.length)}`
            : `${pad(vehicle ? index + 1 : 0)} / ${pad(vehicles.length)}`}
        </Text>
      </View>

      <View style={styles.stage}>
        <Text style={styles.marque}>
          {showForm
            ? (vehicles.length ? "New vehicle" : "Empty garage")
            : vehicle
              ? `${vehicle.id} · ${vehicle.status.replace("_", " ")}`
              : "Empty garage"}
        </Text>
        <Text style={styles.carName}>
          {showForm ? (spec ? spec.model : "Choose a model") : vehicle ? vehicle.name : "No vehicles yet"}
        </Text>
        <Text style={styles.tagline}>
          {showForm
            ? (spec ? "Add an ID and name to register it." : "Pick an EV from the row below.")
            : vehicle
              ? vehicle.model
              : "Connect to the fleet backend to register one."}
        </Text>
        <View style={styles.chips}>
          {(showForm && spec
            ? [bodyLabel(spec.model), `${spec.battery_capacity_kwh} kWh`, `${spec.baseline_efficiency_wh_km} Wh/km`, `${spec.curb_mass_kg.toLocaleString("en-US")} kg`]
            : vehicle
              ? [bodyLabel(vehicle.model), `${vehicle.battery_capacity_kwh} kWh`, vehicle.status.replace("_", " "), ...(vehicle.battery_history?.stress_class ? [`${vehicle.battery_history.stress_class.toLowerCase()} battery stress`] : [])]
              : []
          ).map((chip) => (
            <Text key={chip} style={styles.chip}>{chip}</Text>
          ))}
        </View>
        <Text style={styles.stageNote}>The 3D lift is on the web garage. This screen uses the same bays and registration.</Text>
      </View>

      {showForm ? (
        <RegisterForm
          vehicles={vehicles}
          spec={spec}
          bay={vehicles.length + 1}
          onCreate={onCreate!}
          onCreated={(created) => {
            setAdding(false);
            setPick(null);
            onSelectVehicle(created);
          }}
        />
      ) : vehicle ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>Vehicle sheet · {vehicle.id} · Bay {pad(index + 1)}</Text>
          <Spec label="State of charge" value={vehicle.current_soc.toFixed(0)} unit="%" fraction={vehicle.current_soc / 100} />
          <Spec label="Battery health" value={vehicle.current_soh.toFixed(1)} unit="%" fraction={vehicle.current_soh / 100} />
          <Spec label="Battery capacity" value={String(vehicle.battery_capacity_kwh)} unit="kWh" fraction={vehicle.battery_capacity_kwh / 200} />
          <Spec label="Efficiency" value={String(vehicle.baseline_efficiency_wh_km)} unit="Wh/km" fraction={vehicle.baseline_efficiency_wh_km / 300} />
          {vehicle.curb_mass_kg != null ? (
            <Spec label="Curb mass" value={vehicle.curb_mass_kg.toLocaleString("en-US")} unit="kg" fraction={vehicle.curb_mass_kg / 3500} />
          ) : null}
          <Text style={styles.hint}>{formatBatteryState(vehicle)}</Text>
          <Text style={styles.selected}>{vehicle.name} selected</Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
        {showForm
          ? EV_MODELS.map((model, i) => (
            <TouchableOpacity key={model.model} style={[styles.slot, i === pick && styles.slotOn]} onPress={() => setPick(i)}>
              <Text style={styles.slotN}>{pad(i + 1)}</Text>
              <Text style={styles.slotT} numberOfLines={2}>{model.model}</Text>
              <Text style={styles.slotS}>{model.battery_capacity_kwh} kWh · {bodyLabel(model.model)}</Text>
            </TouchableOpacity>
          ))
          : vehicles.map((item, i) => (
            <TouchableOpacity key={item.id} style={[styles.slot, item.id === vehicle?.id && styles.slotOn]} onPress={() => onSelectVehicle(item)}>
              <Text style={styles.slotN}>{pad(i + 1)}</Text>
              <Text style={styles.slotT} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.slotS} numberOfLines={2}>{item.id} · {item.model}</Text>
            </TouchableOpacity>
          ))}
        {!showForm && onCreate ? (
          <TouchableOpacity style={styles.slot} onPress={() => setAdding(true)}>
            <Text style={styles.slotN}>{pad(vehicles.length + 1)}</Text>
            <Text style={styles.slotT}>New vehicle</Text>
            <Text style={styles.slotS}>Register an EV</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {showForm && vehicles.length > 0 ? (
        <TouchableOpacity style={styles.secondary} onPress={() => { setAdding(false); setPick(null); }}>
          <Text style={styles.secondaryText}>Back to fleet</Text>
        </TouchableOpacity>
      ) : null}
      {dataStatus !== "live" ? (
        <Text style={styles.hint}>Connect to the fleet backend to add vehicles.</Text>
      ) : null}
    </ScrollView>
  );
};

function RegisterForm({
  vehicles, spec, bay, onCreate, onCreated,
}: {
  vehicles: Vehicle[];
  spec: EvModel | null;
  bay: number;
  onCreate: (payload: VehicleCreate) => Promise<Vehicle>;
  onCreated: (vehicle: Vehicle) => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("AVAILABLE");
  const [soc, setSoc] = useState("80");
  const [soh, setSoh] = useState("100");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const errors: Record<string, string> = {};
  if (!id.trim()) errors.id = "Vehicle ID is required.";
  else if (vehicles.some((vehicle) => vehicle.id === id.trim())) errors.id = "A vehicle with this ID already exists.";
  if (!name.trim()) errors.name = "Name is required.";
  if (!spec) errors.model = "Pick a model from the garage row first.";
  const socN = Number(soc);
  const sohN = Number(soh);
  if (!Number.isFinite(socN) || socN < 0 || socN > 100) errors.soc = "Must be from 0 to 100.";
  if (!Number.isFinite(sohN) || sohN < 0 || sohN > 100) errors.soh = "Must be from 0 to 100.";

  const submit = async () => {
    setShowErrors(true);
    setMessage(null);
    if (!spec || Object.keys(errors).length > 0 || submitting) return;
    setSubmitting(true);
    try {
      const created = await onCreate({
        id: id.trim(),
        name: name.trim(),
        model: spec.model,
        battery_capacity_kwh: spec.battery_capacity_kwh,
        baseline_efficiency_wh_km: spec.baseline_efficiency_wh_km,
        curb_mass_kg: spec.curb_mass_kg,
        regen_efficiency: 0.6,
        current_soc: socN,
        current_soh: sohN,
        status,
      });
      setMessage(`${created.id} added to the fleet.`);
      onCreated(created);
    } catch (err) {
      setMessage(`Could not add vehicle: ${err instanceof Error ? err.message : "request failed"}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetTitle}>Add a vehicle · Bay {pad(bay)}</Text>
      <Text style={styles.hint}>Register an EV so it appears on the dashboard and in trip planning.</Text>
      <Field label="Vehicle ID" value={id} onChange={setId} hint="Unique, e.g. EV-101" error={showErrors ? errors.id : undefined} />
      <Field label="Name" value={name} onChange={setName} hint="Display name, e.g. Delivery van 1" error={showErrors ? errors.name : undefined} />
      <Text style={styles.label}>Make & model</Text>
      <Text style={styles.model}>{spec ? spec.model : "None picked yet"}</Text>
      <Text style={showErrors && errors.model ? styles.error : styles.hint}>
        {showErrors && errors.model ? errors.model : spec ? formatEvSpecs(spec) : "Pick one from the row; it sets battery size, efficiency and weight"}
      </Text>
      <Text style={styles.label}>Status</Text>
      <View style={styles.statusRow}>
        {STATUSES.map((item) => (
          <TouchableOpacity key={item} style={[styles.status, status === item && styles.slotOn]} onPress={() => setStatus(item)}>
            <Text style={styles.slotS}>{item.replace("_", " ")}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Field label="Current charge (%)" value={soc} onChange={setSoc} hint="State of charge, 0–100" error={showErrors ? errors.soc : undefined} numeric />
      <Field label="Battery health (%)" value={soh} onChange={setSoh} hint="State of health, 0–100" error={showErrors ? errors.soh : undefined} numeric />
      {message ? <Text style={styles.hint}>{message}</Text> : null}
      <TouchableOpacity style={[styles.primary, submitting && styles.off]} disabled={submitting} onPress={submit}>
        <Text style={styles.primaryText}>{submitting ? "Adding…" : "Add vehicle"}</Text>
      </TouchableOpacity>
    </View>
  );
}

function Field({
  label, value, onChange, hint, error, numeric,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint: string;
  error?: string;
  numeric?: boolean;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? "decimal-pad" : "default"}
        style={[styles.input, error && styles.inputBad]}
      />
      <Text style={error ? styles.error : styles.hint}>{error ?? hint}</Text>
    </View>
  );
}

function Spec({ label, value, unit, fraction }: { label: string; value: string; unit: string; fraction: number }) {
  return (
    <View style={styles.spec}>
      <Text style={styles.hint}>{label}</Text>
      <Text style={styles.specValue}>{value} {unit}</Text>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.min(100, Math.max(4, fraction * 100))}%` }]} /></View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bgBase },
  content: { padding: 16, paddingBottom: 28 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 12, marginBottom: 12 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  counter: { color: colors.accentCyan, fontWeight: "700", fontFamily: "monospace" },
  stage: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
    marginBottom: 12,
  },
  marque: { color: colors.accentCyan, fontSize: 11, fontWeight: "700", letterSpacing: 0.4 },
  carName: { color: colors.textPrimary, fontSize: 22, fontWeight: "700", marginTop: 4 },
  tagline: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: {
    color: colors.textSecondary,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
  },
  stageNote: { color: colors.textMuted, fontSize: 11, marginTop: 10, lineHeight: 16 },
  sheet: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
    marginBottom: 12,
  },
  sheetTitle: { color: colors.textPrimary, fontWeight: "700", marginBottom: 6 },
  spec: { marginTop: 8 },
  specValue: { color: colors.textPrimary, fontWeight: "700" },
  bar: { height: 4, backgroundColor: colors.bgInput, borderRadius: 2, marginTop: 4, overflow: "hidden" },
  barFill: { height: 4, backgroundColor: colors.accentCyan },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 8 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  error: { color: colors.errorText, fontSize: 12, marginTop: 4 },
  model: { color: colors.textPrimary, fontSize: 14, fontWeight: "600", marginTop: 4 },
  input: {
    color: colors.textPrimary,
    backgroundColor: colors.bgInput,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 4,
  },
  inputBad: { borderColor: colors.riskDanger },
  statusRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  status: { borderWidth: 1, borderColor: colors.borderColor, borderRadius: 8, padding: 8 },
  rail: { gap: 8, paddingBottom: 8 },
  slot: {
    width: 148,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderColor,
    borderRadius: 10,
    padding: 10,
  },
  slotOn: { borderColor: colors.accentCyan, backgroundColor: "rgba(0, 194, 255, 0.12)" },
  slotN: { color: colors.textMuted, fontSize: 10, fontFamily: "monospace" },
  slotT: { color: colors.textPrimary, fontWeight: "700", fontSize: 13, marginTop: 4 },
  slotS: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  primary: { backgroundColor: colors.accentCyan, borderRadius: 8, paddingVertical: 12, alignItems: "center", marginTop: 12 },
  primaryText: { color: "#0a0e17", fontWeight: "700" },
  off: { opacity: 0.5 },
  secondary: { alignSelf: "flex-start", marginTop: 8, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.accentCyan },
  secondaryText: { color: colors.accentCyan, fontWeight: "700" },
  selected: { color: colors.accentCyan, fontWeight: "700", marginTop: 10 },
});
