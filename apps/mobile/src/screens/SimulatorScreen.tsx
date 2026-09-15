import React, { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { SimulationResponse, Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";
import { Header, SimulationResult, ErrorBanner } from "../components";

interface SimulatorScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onRunSimulation: (params: {
    vehicle_id: string;
    route_distance_km: number;
    elevation_gain_m: number;
    ambient_temp_c: number;
    payload_kg: number;
    hvac_mode: "OFF" | "LOW" | "HIGH";
    driving_style: "ECO" | "NORMAL" | "AGGRESSIVE";
    regen_level: "LOW" | "MEDIUM" | "HIGH";
    reserve_soc_target_pct: number;
  }) => Promise<SimulationResponse | null>;
  simResult: SimulationResponse | null;
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
  simResult,
  loading,
  error,
  refreshing = false,
  onRefresh,
}) => {
  const [distanceKm, setDistanceKm] = useState<number>(120);
  const [elevationGainM, setElevationGainM] = useState<number>(350);
  const [ambientTempC, setAmbientTempC] = useState<number>(18);
  const [payloadKg, setPayloadKg] = useState<number>(250);
  const [hvacMode, setHvacMode] = useState<"OFF" | "LOW" | "HIGH">("LOW");
  const [drivingStyle, setDrivingStyle] = useState<"ECO" | "NORMAL" | "AGGRESSIVE">("NORMAL");
  const [regenLevel, setRegenLevel] = useState<"LOW" | "MEDIUM" | "HIGH">("MEDIUM");

  const activeVehicle = selectedVehicle || vehicles[0];

  const handleSimulate = async () => {
    if (!activeVehicle) return;
    await onRunSimulation({
      vehicle_id: activeVehicle.id,
      route_distance_km: distanceKm,
      elevation_gain_m: elevationGainM,
      ambient_temp_c: ambientTempC,
      payload_kg: payloadKg,
      hvac_mode: hvacMode,
      driving_style: drivingStyle,
      regen_level: regenLevel,
      reserve_soc_target_pct: 15,
    });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
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

      {error && <ErrorBanner message={error} onRetry={() => {}} />}

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
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Route Parameters */}
      <View style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Route & Environmental Conditions</Text>

        {/* Distance Selector */}
        <Text style={styles.inputLabel}>Route Distance</Text>
        <View style={styles.pillRow}>
          {[40, 80, 120, 200].map((km) => (
            <TouchableOpacity
              key={km}
              style={[styles.pill, distanceKm === km && styles.pillActive]}
              onPress={() => setDistanceKm(km)}
            >
              <Text
                style={[
                  styles.pillText,
                  distanceKm === km && styles.pillTextActive,
                ]}
              >
                {km} km
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Elevation Gain */}
        <Text style={styles.inputLabel}>Elevation Ascent</Text>
        <View style={styles.pillRow}>
          {[
            { label: "Flat (50m)", val: 50 },
            { label: "Hilly (350m)", val: 350 },
            { label: "Mountain (750m)", val: 750 },
          ].map((item) => (
            <TouchableOpacity
              key={item.val}
              style={[
                styles.pill,
                elevationGainM === item.val && styles.pillActive,
              ]}
              onPress={() => setElevationGainM(item.val)}
            >
              <Text
                style={[
                  styles.pillText,
                  elevationGainM === item.val && styles.pillTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Ambient Temperature */}
        <Text style={styles.inputLabel}>Ambient Temperature</Text>
        <View style={styles.pillRow}>
          {[
            { label: "0°C (Cold)", val: 0 },
            { label: "18°C (Mild)", val: 18 },
            { label: "35°C (Hot)", val: 35 },
          ].map((item) => (
            <TouchableOpacity
              key={item.val}
              style={[
                styles.pill,
                ambientTempC === item.val && styles.pillActive,
              ]}
              onPress={() => setAmbientTempC(item.val)}
            >
              <Text
                style={[
                  styles.pillText,
                  ambientTempC === item.val && styles.pillTextActive,
                ]}
              >
                {item.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Payload */}
        <Text style={styles.inputLabel}>Cargo Payload</Text>
        <View style={styles.pillRow}>
          {[0, 250, 600, 1200].map((kg) => (
            <TouchableOpacity
              key={kg}
              style={[styles.pill, payloadKg === kg && styles.pillActive]}
              onPress={() => setPayloadKg(kg)}
            >
              <Text
                style={[
                  styles.pillText,
                  payloadKg === kg && styles.pillTextActive,
                ]}
              >
                {kg === 0 ? "Empty" : `${kg} kg`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* HVAC Mode */}
        <Text style={styles.inputLabel}>HVAC Cabin Climate</Text>
        <View style={styles.pillRow}>
          {(["OFF", "LOW", "HIGH"] as const).map((mode) => (
            <TouchableOpacity
              key={mode}
              style={[styles.pill, hvacMode === mode && styles.pillActive]}
              onPress={() => setHvacMode(mode)}
            >
              <Text
                style={[
                  styles.pillText,
                  hvacMode === mode && styles.pillTextActive,
                ]}
              >
                {mode}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Driving Style */}
        <Text style={styles.inputLabel}>Driver Behavior</Text>
        <View style={styles.pillRow}>
          {(["ECO", "NORMAL", "AGGRESSIVE"] as const).map((style) => (
            <TouchableOpacity
              key={style}
              style={[
                styles.pill,
                drivingStyle === style && styles.pillActive,
              ]}
              onPress={() => setDrivingStyle(style)}
            >
              <Text
                style={[
                  styles.pillText,
                  drivingStyle === style && styles.pillTextActive,
                ]}
              >
                {style}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Run Simulation Button */}
        <TouchableOpacity
          style={styles.runButton}
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
            {loading ? "Calculating Telematics..." : "Run Physics Simulation"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Simulation Result Output */}
      {simResult && (
        <View style={styles.resultWrapper}>
          <SimulationResult result={simResult} />
        </View>
      )}
    </ScrollView>
  );
};

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
