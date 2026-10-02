import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBatteryState } from "@fleet/api-client";
import type { SimulationResponse } from "@fleet/api-client";
import { colors } from "../constants/theme";

interface SimulationResultProps {
  result: SimulationResponse;
  origin?: "backend" | "local";
}

export const SimulationResult: React.FC<SimulationResultProps> = ({ result, origin = "backend" }) => {
  const getBadgeStyle = () => {
    switch (result.risk_level) {
      case "SAFE":
        return styles.riskSafe;
      case "CAUTION":
        return styles.riskCaution;
      default:
        return styles.riskDanger;
    }
  };

  const getTextStyle = () => {
    switch (result.risk_level) {
      case "SAFE":
        return { color: colors.riskSafeText };
      case "CAUTION":
        return { color: colors.riskCautionText };
      default:
        return { color: colors.riskDangerText };
    }
  };

  return (
    <View style={styles.resultCard}>
      <Text style={styles.resultTitle}>Simulation Feasibility — {result.vehicle_id}</Text>
      {origin === "local" && <Text style={styles.detailRow}>Offline demo estimate</Text>}
      <Text style={styles.detailRow}>{formatBatteryState(result)}</Text>
      <Text style={styles.detailRow}>
        Starting SOC: {result.starting_soc_pct.toFixed(1)}% · SOH: {result.starting_soh_pct.toFixed(1)}%
      </Text>
      <View style={[styles.riskBadge, getBadgeStyle()]}>
        <Text style={[styles.riskText, getTextStyle()]}>{result.risk_level}</Text>
      </View>
      <Text style={styles.detailRow}>
        Projected Arrival SOC: {result.projected_arrival_soc_pct.toFixed(1)}%
      </Text>
      <Text style={styles.detailRow}>
        Estimated Consumption: {result.estimated_energy_consumption_kwh.toFixed(1)} kWh
      </Text>
      <Text style={styles.detailRow}>
        Remaining Range: {result.remaining_range_km.toFixed(1)} km
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  resultCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  riskBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginBottom: 10,
  },
  riskSafe: {
    backgroundColor: colors.riskSafeBg,
  },
  riskCaution: {
    backgroundColor: colors.riskCautionBg,
  },
  riskDanger: {
    backgroundColor: colors.riskDangerBg,
  },
  riskText: {
    fontWeight: "700",
    fontSize: 12,
  },
  detailRow: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
});
