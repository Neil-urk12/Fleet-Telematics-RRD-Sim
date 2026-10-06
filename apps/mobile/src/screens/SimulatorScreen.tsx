import React, { useState } from "react";
import {
  Keyboard,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  formatBatteryState,
  isAssessmentOutdated,
  parseSimulationInputs,
  simulationNumericFields,
} from "@fleet/api-client";
import type {
  DrivingStyle,
  HvacMode,
  RegenLevel,
  RoadType,
  SimulationAssessment,
  SimulationNumericDraft,
  SimulationRequest,
  SimulationResponse,
  Vehicle,
} from "@fleet/api-client";
import { colors } from "../constants/theme";
import { Header, SimulationResult, ErrorBanner } from "../components";

interface SimulatorScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onRunSimulation: (params: Required<SimulationRequest>) => Promise<SimulationResponse | null>;
  assessment: SimulationAssessment | null;
  loading: boolean;
  error: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export const SimulatorScreen: React.FC<SimulatorScreenProps> = ({
  vehicles,
  selectedVehicle,
  onSelectVehicle,
  onRunSimulation,
  assessment,
  loading,
  error,
  refreshing = false,
  onRefresh,
}) => {
  const [values, setValues] = useState<SimulationNumericDraft>({
    route_distance_km: "120",
    elevation_gain_m: "350",
    elevation_loss_m: "0",
    ambient_temp_c: "18",
    payload_kg: "250",
    reserve_soc_target_pct: "15",
  });
  const [roadType, setRoadType] = useState<RoadType>("MIXED");
  const [hvacMode, setHvacMode] = useState<HvacMode>("LOW");
  const [drivingStyle, setDrivingStyle] = useState<DrivingStyle>("NORMAL");
  const [regenLevel, setRegenLevel] = useState<RegenLevel>("MEDIUM");
  const [showErrors, setShowErrors] = useState(false);
  const { parameters, errors } = parseSimulationInputs(values);

  const activeVehicle = selectedVehicle || vehicles[0];
  const currentRequest = parameters && activeVehicle ? {
    ...parameters,
    vehicle_id: activeVehicle.id,
    road_type: roadType,
    hvac_mode: hvacMode,
    driving_style: drivingStyle,
    regen_level: regenLevel,
  } : null;

  const handleSimulate = async () => {
    setShowErrors(true);
    if (!currentRequest || loading) return;
    Keyboard.dismiss();
    await onRunSimulation(currentRequest);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accentPrimary}
            colors={[colors.accentPrimary]}
            progressBackgroundColor={colors.bgSurface}
          />
        ) : undefined
      }
    >
      <Header
        title="Route Simulator"
        subtitle="Physics-based Energy & Risk Prediction"
      />

      {error && <ErrorBanner message={error} onRetry={handleSimulate} />}

      {/* Target Vehicle Selector */}
      <View style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Selected Vehicle</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.vehicleScroll}
        >
          {vehicles.map((v) => {
            const isChosen = activeVehicle?.id === v.id;
            return (
              <TouchableOpacity
                key={v.id}
                style={[
                  styles.vehicleOption,
                  isChosen && styles.vehicleOptionActive,
                ]}
                onPress={() => onSelectVehicle(v)}
              >
                <Text
                  style={[
                    styles.vehicleOptionName,
                    isChosen && styles.vehicleOptionNameActive,
                  ]}
                >
                  {v.name}
                </Text>
                <Text style={styles.vehicleOptionSub}>
                  {v.battery_capacity_kwh}kWh • {v.current_soc}% SOC
                </Text>
                <Text style={styles.vehicleOptionSub}>{formatBatteryState(v)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Route Parameters */}
      <View style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Route & Environmental Conditions</Text>

        <View style={styles.numericGrid}>
          {simulationNumericFields.map((field) => {
            const fieldError = showErrors ? errors[field.key] : undefined;
            return (
              <View key={field.key} style={styles.numericField}>
                <Text style={styles.inputLabel}>{field.label}</Text>
                <TextInput
                  accessibilityLabel={field.label}
                  value={values[field.key]}
                  onChangeText={(value) => setValues((previous) => ({ ...previous, [field.key]: value }))}
                  keyboardType={field.key === "ambient_temp_c"
                    ? (Platform.OS === "ios" ? "numbers-and-punctuation" : "default")
                    : "decimal-pad"}
                  style={[styles.numericInput, fieldError && styles.numericInputInvalid]}
                />
                {fieldError && (
                  <Text accessibilityRole="alert" style={styles.fieldError}>{fieldError}</Text>
                )}
              </View>
            );
          })}
        </View>
        <Text style={styles.inputHint}>Arrival reserve can be set from 0 to 50%.</Text>
        <ChoiceField label="Road type" options={["URBAN", "HIGHWAY", "MIXED"]}
          value={roadType} onChange={setRoadType} />
        <ChoiceField label="HVAC" options={["OFF", "LOW", "MEDIUM", "HIGH"]}
          value={hvacMode} onChange={setHvacMode} />
        <ChoiceField label="Driving style" options={["ECO", "NORMAL", "AGGRESSIVE"]}
          value={drivingStyle} onChange={setDrivingStyle} />
        <ChoiceField label="Regen" options={["OFF", "LOW", "MEDIUM", "HIGH"]}
          value={regenLevel} onChange={setRegenLevel} />

        {/* Run Simulation Button */}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ disabled: loading || !activeVehicle }}
          style={[styles.runButton, (loading || !activeVehicle) && styles.runButtonDisabled]}
          onPress={handleSimulate}
          disabled={loading || !activeVehicle}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons
            name="play-circle-outline"
            size={20}
            color="#FFFFFF"
            style={{ marginRight: 8 }}
          />
          <Text style={styles.runButtonText}>
            {loading ? "Assessing route…" : "Assess route"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Simulation Result Output */}
      {assessment && (
        <View style={styles.resultWrapper}>
          <SimulationResult assessment={assessment}
            isOutdated={isAssessmentOutdated(assessment, currentRequest, activeVehicle)} />
        </View>
      )}
    </ScrollView>
  );
};

function ChoiceField<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <Text style={styles.inputLabel}>{label}</Text>
      <View style={styles.pillRow}>
        {options.map((option) => (
          <TouchableOpacity key={option}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${option}`}
            accessibilityState={{ checked: value === option }}
            aria-checked={value === option}
            style={[styles.pill, value === option && styles.pillActive]}
            onPress={() => onChange(option)}>
            <Text style={[styles.pillText, value === option && styles.pillTextActive]}>{option}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  sectionCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 12,
  },
  vehicleScroll: {
    gap: 8,
  },
  vehicleOption: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.bgSurfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  vehicleOptionActive: {
    backgroundColor: colors.badgeBg,
    borderColor: colors.accentPrimary,
  },
  vehicleOptionName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  vehicleOptionNameActive: {
    color: colors.accentPrimary,
  },
  vehicleOptionSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  inputLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textSecondary,
    marginTop: 10,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  numericGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  numericField: {
    flexGrow: 1,
    flexBasis: "46%",
    minWidth: 130,
  },
  numericInput: {
    color: colors.textPrimary,
    backgroundColor: colors.bgSurfaceAlt,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    fontSize: 16,
  },
  numericInputInvalid: {
    borderColor: colors.riskDanger,
  },
  fieldError: {
    color: colors.errorText,
    fontSize: 12,
    marginTop: 4,
  },
  inputHint: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 10,
  },
  runButtonDisabled: {
    opacity: 0.5,
  },
  pillRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  pill: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.bgSurfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillActive: {
    backgroundColor: colors.badgeBg,
    borderColor: colors.accentPrimary,
  },
  pillText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  pillTextActive: {
    color: colors.accentPrimary,
    fontWeight: "700",
  },
  runButton: {
    backgroundColor: colors.accentPrimary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 10,
    marginTop: 18,
  },
  runButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
  },
  resultWrapper: {
    marginBottom: 16,
  },
});
