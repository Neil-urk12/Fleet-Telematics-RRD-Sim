import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import {
  formatBatteryState,
  isAssessmentOutdated,
  parseSimulationInputs,
  simulationNumericFields,
} from "@fleet/api-client";
import type {
  BatchSimulationResponse,
  CompareSimulationResponse,
  DegradationResponse,
  DrivingStyle,
  HvacMode,
  RegenLevel,
  RoadType,
  SimulationAssessment,
  SimulationNumericDraft,
  SimulationRecord,
  SimulationRequest,
  SimulationResponse,
  Vehicle,
} from "@fleet/api-client";
import { colors } from "../constants/theme";
import { client } from "../config/api";
import { SimulationResult, ErrorBanner } from "../components";
import { ROUTE_DISTANCE_KM, ROUTE_ELEVATION } from "../manilaBaguioRoute";

interface SimulatorScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onRunSimulation: (params: Required<SimulationRequest>) => Promise<SimulationResponse | null>;
  assessment: SimulationAssessment | null;
  loading: boolean;
  error: string | null;
  dataStatus: "demo" | "live" | "cached";
  onNavigateTab?: (tab: "garage") => void;
}

const FIELD_COPY: Record<string, { label: string; hint: string }> = {
  route_distance_km: { label: "Trip distance (km)", hint: "How far you are driving" },
  elevation_gain_m: { label: "Total uphill (m)", hint: "Climbing uses more battery" },
  elevation_loss_m: { label: "Total downhill (m)", hint: "Some energy is recovered" },
  ambient_temp_c: { label: "Outside temperature (°C)", hint: "Cold weather reduces range" },
  payload_kg: { label: "Cargo & passengers (kg)", hint: "Extra weight on board" },
  reserve_soc_target_pct: { label: "Battery to keep on arrival (%)", hint: "Your safety margin, 0–50" },
};

const PRESETS: { label: string; distanceKm: number; gainM: number; lossM: number; roadType: RoadType }[] = [
  { label: "Manila → Baguio (Marcos Highway)", distanceKm: ROUTE_DISTANCE_KM, gainM: ROUTE_ELEVATION.gain, lossM: ROUTE_ELEVATION.loss, roadType: "MIXED" },
  { label: "City deliveries", distanceKm: 60, gainM: 120, lossM: 120, roadType: "URBAN" },
  { label: "Flat highway run", distanceKm: 200, gainM: 150, lossM: 150, roadType: "HIGHWAY" },
];

const ROADS: { value: RoadType; label: string }[] = [
  { value: "URBAN", label: "City" },
  { value: "HIGHWAY", label: "Highway" },
  { value: "MIXED", label: "Mixed" },
];

const LEVELS = ["OFF", "LOW", "MEDIUM", "HIGH"] as const;
const levelLabel = (level: string) => level[0] + level.slice(1).toLowerCase();

export const SimulatorScreen: React.FC<SimulatorScreenProps> = ({
  vehicles,
  selectedVehicle,
  onSelectVehicle,
  onRunSimulation,
  assessment,
  loading,
  error,
  dataStatus,
  onNavigateTab,
}) => {
  const [values, setValues] = useState<SimulationNumericDraft>({
    route_distance_km: String(ROUTE_DISTANCE_KM),
    elevation_gain_m: String(ROUTE_ELEVATION.gain),
    elevation_loss_m: String(ROUTE_ELEVATION.loss),
    ambient_temp_c: "31",
    payload_kg: "450",
    reserve_soc_target_pct: "15",
  });
  const [roadType, setRoadType] = useState<RoadType>("MIXED");
  const [hvacMode, setHvacMode] = useState<HvacMode>("LOW");
  const [drivingStyle, setDrivingStyle] = useState<DrivingStyle>("NORMAL");
  const [regenLevel, setRegenLevel] = useState<RegenLevel>("MEDIUM");
  const [showErrors, setShowErrors] = useState(false);
  const [comparison, setComparison] = useState<BatchSimulationResponse | null>(null);
  const [isComparing, setIsComparing] = useState(false);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [history, setHistory] = useState<SimulationRecord[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const { parameters, errors } = parseSimulationInputs(values);

  const activeVehicle = selectedVehicle ?? vehicles[0] ?? null;
  const currentRequest = parameters && activeVehicle ? {
    ...parameters,
    vehicle_id: activeVehicle.id,
    road_type: roadType,
    hvac_mode: hvacMode,
    driving_style: drivingStyle,
    regen_level: regenLevel,
  } : null;
  const activePreset = PRESETS.find((preset) => parameters
    && preset.distanceKm === parameters.route_distance_km
    && preset.gainM === parameters.elevation_gain_m
    && preset.lossM === parameters.elevation_loss_m
    && preset.roadType === roadType)?.label ?? "";
  const isOutdated = assessment ? isAssessmentOutdated(assessment, currentRequest, activeVehicle) : false;
  const connected = dataStatus === "live";

  useEffect(() => {
    const vehicleId = activeVehicle?.id;
    if (!vehicleId || !connected) {
      setHistory(null);
      return;
    }
    let cancelled = false;
    setHistoryError(null);
    client.getSimulationHistory(vehicleId).then(
      (records) => {
        if (cancelled) return;
        setHistory([...records].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 10));
      },
      (err) => {
        if (!cancelled) setHistoryError(err instanceof Error ? err.message : "Request failed");
      },
    );
    return () => { cancelled = true; };
  }, [activeVehicle?.id, connected, assessment]);

  const handleSimulate = async () => {
    setShowErrors(true);
    if (!currentRequest || loading) return;
    Keyboard.dismiss();
    setComparison(null);
    await onRunSimulation(currentRequest);
  };

  const applySetup = (setup: Setup) => {
    setDrivingStyle(setup.driving_style);
    setHvacMode(setup.hvac_mode);
    setRegenLevel(setup.regen_level);
  };

  // Loads a saved run into the form and assesses it against the vehicle's current battery state.
  const handleRerun = (request: Required<SimulationRequest>) => {
    if (loading) return;
    setValues({
      route_distance_km: String(request.route_distance_km),
      elevation_gain_m: String(request.elevation_gain_m),
      elevation_loss_m: String(request.elevation_loss_m),
      ambient_temp_c: String(request.ambient_temp_c),
      payload_kg: String(request.payload_kg),
      reserve_soc_target_pct: String(request.reserve_soc_target_pct),
    });
    setRoadType(request.road_type);
    applySetup(request);
    setComparison(null);
    setOpenRecordId(null);
    void onRunSimulation(request);
  };

  const handleCompare = async () => {
    if (!assessment || isComparing || isOutdated || !connected) return;
    const available = vehicles.filter((vehicle) => vehicle.status === "AVAILABLE");
    if (available.length === 0) return;
    setIsComparing(true);
    setComparison(null);
    setComparisonError(null);
    const { vehicle_id: _vehicleId, ...conditions } = assessment.request;
    try {
      setComparison(await client.runBatchSimulation({
        ...conditions,
        vehicle_ids: available.map((vehicle) => vehicle.id),
      }));
    } catch (err) {
      setComparisonError(err instanceof Error ? err.message : "Fleet comparison failed");
    } finally {
      setIsComparing(false);
    }
  };

  if (vehicles.length === 0 || !activeVehicle) {
    return (
      <View style={styles.empty}>
        <Text style={styles.title}>No vehicles yet</Text>
        <Text style={styles.hint}>Add your first vehicle to see fleet data, plan trips and view battery details.</Text>
      </View>
    );
  }

  const availableVehicles = vehicles.filter((vehicle) => vehicle.status === "AVAILABLE");
  const comparisonRows = (comparison?.results ?? []).map((item) => ({ ...item, vehicle: vehicles.find((vehicle) => vehicle.id === item.vehicle_id) }))
    .sort((a, b) => (b.response?.projected_arrival_soc_pct ?? -Infinity) - (a.response?.projected_arrival_soc_pct ?? -Infinity));

  return (
    <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
      <Text style={styles.title}>Trip planner</Text>
      <Text style={styles.subtitle}>Check whether a vehicle can finish a trip with its reserve intact.</Text>
      {error ? <ErrorBanner message={error} onRetry={handleSimulate} /> : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Will this trip make it?</Text>
        <Text style={styles.hint}>Pick a vehicle and an example trip (or type your own numbers), then press Simulate trip.</Text>

        <Text style={styles.step}>1  Vehicle & route</Text>
        <Text style={styles.label}>Which vehicle?</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {vehicles.map((vehicle) => {
            const selected = vehicle.id === activeVehicle.id;
            return (
              <TouchableOpacity key={vehicle.id} style={[styles.chip, selected && styles.chipOn]} onPress={() => onSelectVehicle(vehicle)}>
                <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={2}>
                  {vehicle.id} · {vehicle.model} · {Math.round(vehicle.current_soc)}% charged
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <Text style={styles.hint}>Also selectable from the fleet list</Text>
        <TouchableOpacity style={styles.secondary} onPress={() => onNavigateTab?.("garage")} disabled={vehicles.length === 0}>
          <Text style={styles.secondaryText}>Browse vehicles in garage</Text>
        </TouchableOpacity>

        <ChoiceRow
          label="Start from an example trip"
          hint="Fills distance, hills and road type. You can still edit them."
          options={PRESETS.map((preset) => ({ value: preset.label, label: preset.label }))}
          value={activePreset}
          onChange={(label) => {
            const preset = PRESETS.find((item) => item.label === label);
            if (!preset) return;
            setValues((previous) => ({
              ...previous,
              route_distance_km: String(preset.distanceKm),
              elevation_gain_m: String(preset.gainM),
              elevation_loss_m: String(preset.lossM),
            }));
            setRoadType(preset.roadType);
          }}
        />

        <Text style={styles.step}>2  Trip</Text>
        {simulationNumericFields.map((field) => {
          const fieldError = showErrors ? errors[field.key] : undefined;
          const copy = FIELD_COPY[field.key] ?? { label: field.label, hint: "" };
          return (
            <View key={field.key}>
              <Text style={styles.label}>{copy.label}</Text>
              <TextInput
                accessibilityLabel={copy.label}
                value={values[field.key]}
                onChangeText={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
                keyboardType={field.key === "ambient_temp_c"
                  ? (Platform.OS === "ios" ? "numbers-and-punctuation" : "default")
                  : "decimal-pad"}
                style={[styles.input, fieldError && styles.inputInvalid]}
              />
              <Text style={fieldError ? styles.error : styles.hint}>{fieldError ?? copy.hint}</Text>
            </View>
          );
        })}
        <ChoiceRow
          label="Road type"
          hint="Mostly city, highway, or both"
          options={ROADS}
          value={roadType}
          onChange={setRoadType}
        />

        <Text style={styles.step}>3  Driving</Text>
        <ChoiceRow
          label="Driving style"
          hint="Sporty driving drains the battery faster"
          options={[{ value: "ECO" as const, label: "Eco" }, { value: "NORMAL" as const, label: "Normal" }, { value: "AGGRESSIVE" as const, label: "Sporty" }]}
          value={drivingStyle}
          onChange={setDrivingStyle}
        />
        <ChoiceRow
          label="Heating / A/C"
          hint="Climate control uses battery"
          options={LEVELS.map((level) => ({ value: level, label: levelLabel(level) }))}
          value={hvacMode}
          onChange={setHvacMode}
        />
        <ChoiceRow
          label="Energy recovery when braking"
          hint="Higher recovers more energy downhill"
          options={LEVELS.map((level) => ({ value: level, label: levelLabel(level) }))}
          value={regenLevel}
          onChange={setRegenLevel}
        />

        <TouchableOpacity
          style={[styles.run, (loading || !activeVehicle) && styles.runOff]}
          onPress={handleSimulate}
          disabled={loading || !activeVehicle}
        >
          <Text style={styles.runText}>{loading ? "Simulating…" : "Simulate trip"}</Text>
        </TouchableOpacity>
      </View>

      {assessment ? (
        <SimulationResult assessment={assessment} isOutdated={isOutdated} />
      ) : null}

      {assessment?.origin === "backend" ? (
        <View style={styles.card}>
          <Text style={styles.heading}>Compare available vehicles</Text>
          <Text style={styles.hint}>
            Same submitted conditions · {assessment.request.reserve_soc_target_pct ?? 15}% arrival reserve · Sorted by highest reserve margin.
          </Text>
          {!availableVehicles.length ? <Text style={styles.hint}>No available vehicles to compare.</Text> : null}
          {isOutdated ? <Text style={styles.hint}>Assess the current inputs and vehicle again before comparing.</Text> : null}
          {!connected ? <Text style={styles.hint}>Reconnect to the backend to compare or select an alternative.</Text> : null}
          <TouchableOpacity
            style={[styles.secondary, (isComparing || isOutdated || !connected || !availableVehicles.length) && styles.runOff]}
            disabled={isComparing || isOutdated || !connected || !availableVehicles.length}
            onPress={handleCompare}
          >
            <Text style={styles.secondaryText}>{isComparing ? "Comparing…" : "Compare available vehicles"}</Text>
          </TouchableOpacity>
          {comparisonError ? <Text style={styles.error}>{comparisonError}</Text> : null}
          {comparisonRows.map((row) => (
            <View key={row.vehicle_id} style={styles.historyRow}>
              <Text style={styles.label}>{row.vehicle?.name ?? row.vehicle_id} ({row.vehicle_id})</Text>
              {row.response ? (
                <Text style={styles.hint}>
                  {row.response.risk_level.replaceAll("_", " ")} · arrival {row.response.projected_arrival_soc_pct.toFixed(1)}% · {row.response.estimated_energy_consumption_kwh.toFixed(2)} kWh
                  {row.response.state_source ? ` · ${formatBatteryState(row.response)}` : ""}
                </Text>
              ) : <Text style={styles.hint}>{row.error ?? "Assessment unavailable"}</Text>}
              <TouchableOpacity
                disabled={!row.response || isOutdated || !connected || isComparing}
                onPress={() => {
                  const vehicle = vehicles.find((item) => item.id === row.vehicle_id);
                  if (vehicle && currentRequest) {
                    onSelectVehicle(vehicle);
                    void onRunSimulation({ ...currentRequest, vehicle_id: vehicle.id });
                  }
                }}
              >
                <Text style={styles.link}>Select and assess</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {assessment?.origin === "backend" ? (
        <>
          <SetupComparison assessment={assessment} isOutdated={isOutdated} connected={connected} onUseSetup={applySetup} />
          <AgeingOutlook assessment={assessment} isOutdated={isOutdated} connected={connected} />
        </>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.heading}>Recent assessments · {activeVehicle.id}</Text>
        {history?.length ? <Text style={styles.hint}>Tap an assessment to see its full saved result.</Text> : null}
        {!connected ? <Text style={styles.hint}>Saved assessments unavailable until the backend is connected.</Text> : null}
        {historyError ? <Text style={styles.error}>Saved assessments unavailable: {historyError}</Text> : null}
        {connected && !history && !historyError ? <Text style={styles.hint}>Loading saved assessments…</Text> : null}
        {history && history.length === 0 ? <Text style={styles.hint}>No saved assessments for this vehicle yet.</Text> : null}
        {history?.map((record) => {
          const open = record.id === openRecordId;
          // The backend stores every request field with its default filled in.
          const request = record.request as Required<SimulationRequest>;
          return (
          <View key={record.id} style={styles.historyRow}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              onPress={() => setOpenRecordId(open ? null : record.id)}
            >
            <Text style={styles.label}>{open ? "▾" : "▸"} {new Date(record.timestamp).toLocaleString()}</Text>
            <Text style={styles.hint}>
              {record.response.risk_level.replaceAll("_", " ")} · {record.response.projected_arrival_soc_pct.toFixed(1)}% / {record.request.reserve_soc_target_pct ?? "—"}% · {record.response.confidence_score_pct.toFixed(0)}%
            </Text>
            <Text style={styles.hint}>
              {record.request.route_distance_km} km · ↑{record.request.elevation_gain_m ?? "—"} m ↓{record.request.elevation_loss_m ?? "—"} m · {record.request.ambient_temp_c ?? "—"}°C
            </Text>
            </TouchableOpacity>
            {open ? (
              <View>
                <Text style={styles.hint}>Saved result, as assessed at the time. Values do not change with the vehicle's current state.</Text>
                <SimulationResult assessment={{ request, response: record.response, origin: "backend" }} isOutdated={false} />
                <Text style={styles.hint}>A rerun uses the vehicle's current battery state and is saved as a new assessment.</Text>
                <TouchableOpacity
                  style={[styles.secondary, (loading || !connected) && styles.runOff]}
                  disabled={loading || !connected}
                  onPress={() => handleRerun(request)}
                >
                  <Text style={styles.secondaryText}>Rerun with these inputs</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          );
        })}
      </View>
    </ScrollView>
  );
};

type Setup = { label?: string; driving_style: DrivingStyle; hvac_mode: HvacMode; regen_level: RegenLevel };

const SETUP_PRESETS: Required<Setup>[] = [
  { label: "Efficient", driving_style: "ECO", hvac_mode: "OFF", regen_level: "HIGH" },
  { label: "Comfort", driving_style: "NORMAL", hvac_mode: "HIGH", regen_level: "MEDIUM" },
  { label: "Hard driving", driving_style: "AGGRESSIVE", hvac_mode: "HIGH", regen_level: "LOW" },
];

interface ExtraCardProps {
  assessment: SimulationAssessment;
  isOutdated: boolean;
  connected: boolean;
}

/** Same vehicle and route under other driving/HVAC/regen setups (POST /api/simulation/compare). */
function SetupComparison({ assessment, isOutdated, connected, onUseSetup }: ExtraCardProps & { onUseSetup: (setup: Setup) => void }) {
  // Kept with the assessment it was run for, so a new assessment clears it.
  const [result, setResult] = useState<{ assessment: SimulationAssessment; setups: Required<Setup>[]; response: CompareSimulationResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reserve = assessment.request.reserve_soc_target_pct;
  const disabled = busy || isOutdated || !connected;

  const handleCompare = async () => {
    if (disabled) return;
    const { driving_style, hvac_mode, regen_level, ...route } = assessment.request;
    const setups = [
      { label: "As submitted", driving_style, hvac_mode, regen_level },
      ...SETUP_PRESETS.filter((p) => p.driving_style !== driving_style || p.hvac_mode !== hvac_mode || p.regen_level !== regen_level),
    ];
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult({ assessment, setups, response: await client.compareSimulations({ ...route, configs: setups }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup comparison failed");
    } finally {
      setBusy(false);
    }
  };

  // The backend returns one result per config, in the order sent.
  const rows = result?.assessment === assessment
    ? result.response.results.flatMap(({ response }, index) => {
        const setup = result.setups[index];
        return setup ? [{ setup, response }] : [];
      }).sort((a, b) => b.response.projected_arrival_soc_pct - a.response.projected_arrival_soc_pct)
    : [];

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Compare driving setups</Text>
      <Text style={styles.hint}>Same vehicle and route · {reserve}% arrival reserve · Each setup is saved as an assessment.</Text>
      {isOutdated ? <Text style={styles.hint}>Assess the current inputs and vehicle again before comparing.</Text> : null}
      {!connected ? <Text style={styles.hint}>Reconnect to the backend to compare setups.</Text> : null}
      <TouchableOpacity style={[styles.secondary, disabled && styles.runOff]} disabled={disabled} onPress={handleCompare}>
        <Text style={styles.secondaryText}>{busy ? "Comparing…" : "Compare driving setups"}</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error}>Comparison unavailable: {error}</Text> : null}
      {rows.length ? <Text style={styles.hint}>Backend assessments · Heuristic PoC model · Sorted by highest arrival SOC</Text> : null}
      {rows.map(({ setup, response }) => (
        <View key={setup.label} style={styles.historyRow}>
          <Text style={styles.label}>{setup.label}</Text>
          <Text style={styles.hint}>Driving {setup.driving_style} · HVAC {setup.hvac_mode} · Regen {setup.regen_level}</Text>
          <Text style={styles.hint}>
            {response.risk_level.replaceAll("_", " ")} · arrival {response.projected_arrival_soc_pct.toFixed(1)}% · margin {(response.projected_arrival_soc_pct - reserve).toFixed(1)} pp · {response.estimated_energy_consumption_kwh.toFixed(2)} kWh
          </Text>
          <TouchableOpacity accessibilityLabel={`Use the ${setup.label} setup in the trip form`} onPress={() => onUseSetup(setup)}>
            <Text style={styles.link}>Use this setup</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

/** The trip rerun at the SOH projected for later years (POST /api/simulation/degradation; nothing saved). */
function AgeingOutlook({ assessment, isOutdated, connected }: ExtraCardProps) {
  const [result, setResult] = useState<{ assessment: SimulationAssessment; response: DegradationResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reserve = assessment.request.reserve_soc_target_pct;
  const disabled = busy || isOutdated || !connected;
  const projection = result?.assessment === assessment ? result.response : null;
  const rate = projection && `${projection.soh_loss_pct_per_year.toFixed(1)}% SOH lost per year`;

  const handleProject = async () => {
    if (disabled) return;
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      setResult({ assessment, response: await client.projectDegradation(assessment.request) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Projection failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Battery ageing outlook</Text>
      <Text style={styles.hint}>Same trip and charge level at the battery health projected for later years · Not saved as assessments.</Text>
      {isOutdated ? <Text style={styles.hint}>Assess the current inputs and vehicle again before projecting.</Text> : null}
      {!connected ? <Text style={styles.hint}>Reconnect to the backend to project battery ageing.</Text> : null}
      <TouchableOpacity style={[styles.secondary, disabled && styles.runOff]} disabled={disabled} onPress={handleProject}>
        <Text style={styles.secondaryText}>{busy ? "Projecting…" : "Project battery ageing"}</Text>
      </TouchableOpacity>
      {error ? <Text style={styles.error}>Projection unavailable: {error}</Text> : null}
      {projection ? (
        <Text style={styles.hint}>
          {projection.basis === "RECORDED"
            ? `Recorded trend: ${rate}, fitted to ${projection.readings_used} readings over ${projection.span_days.toFixed(0)} days`
            : `Assumed rate: ${rate} (illustrative; under 30 days of recorded SOH history)`}
          {" · Heuristic PoC projection"}
        </Text>
      ) : null}
      {projection?.points.map((point) => (
        <View key={point.years_ahead} style={styles.historyRow}>
          <Text style={styles.label}>
            {point.years_ahead === 0 ? "Today" : `In ${point.years_ahead} year${point.years_ahead === 1 ? "" : "s"}`} · SOH {point.projected_soh_pct.toFixed(1)}%
          </Text>
          <Text style={styles.hint}>
            {point.risk_level.replaceAll("_", " ")} · arrival {point.projected_arrival_soc_pct.toFixed(1)}% · margin {(point.projected_arrival_soc_pct - reserve).toFixed(1)} pp · range {point.predicted_range_km.toFixed(0)} km
          </Text>
        </View>
      ))}
    </View>
  );
}

function ChoiceRow<T extends string>({
  label, hint, options, value, onChange,
}: {
  label: string;
  hint: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.rowWrap}>
        {options.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[styles.chip, value === option.value && styles.chipOn]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.chipText, value === option.value && styles.chipTextOn]}>{option.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.hint}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28 },
  empty: { flex: 1, justifyContent: "center", padding: 32 },
  title: { fontSize: 20, fontWeight: "700", color: colors.textPrimary },
  subtitle: { fontSize: 12, color: colors.textSecondary, marginBottom: 12, lineHeight: 17 },
  card: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
    marginBottom: 12,
  },
  heading: { fontSize: 16, fontWeight: "700", color: colors.textPrimary, marginBottom: 4 },
  step: { marginTop: 14, marginBottom: 6, color: colors.accentCyan, fontWeight: "700", fontSize: 13 },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: "600", marginTop: 8, marginBottom: 4 },
  hint: { color: colors.textMuted, fontSize: 11, lineHeight: 16, marginBottom: 4 },
  error: { color: colors.errorText, fontSize: 12, marginBottom: 4 },
  input: {
    color: colors.textPrimary,
    backgroundColor: colors.bgInput,
    borderColor: colors.borderColor,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputInvalid: { borderColor: colors.riskDanger },
  row: { gap: 8, paddingBottom: 4 },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderColor,
    backgroundColor: colors.bgInput,
    maxWidth: 280,
  },
  chipOn: { borderColor: colors.accentCyan, backgroundColor: "rgba(0, 194, 255, 0.12)" },
  chipText: { color: colors.textSecondary, fontSize: 12 },
  chipTextOn: { color: colors.accentCyan, fontWeight: "700" },
  secondary: {
    alignSelf: "flex-start",
    marginTop: 8,
    marginBottom: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.accentCyan,
  },
  secondaryText: { color: colors.accentCyan, fontWeight: "700", fontSize: 12 },
  run: {
    backgroundColor: colors.accentCyan,
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 12,
  },
  runOff: { opacity: 0.5 },
  runText: { color: "#0a0e17", fontWeight: "700", fontSize: 14 },
  historyRow: { borderTopWidth: 1, borderTopColor: colors.borderColor, paddingVertical: 8 },
  link: { color: colors.accentCyan, fontSize: 12, fontWeight: "700", marginTop: 4 },
});
