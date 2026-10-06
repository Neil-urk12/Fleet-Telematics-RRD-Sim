import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBatteryState, formatSimulationConditions, getSimulationEnergyBreakdown } from "@fleet/api-client";
import type { SimulationAssessment } from "@fleet/api-client";
import { colors } from "../constants/theme";

interface SimulationResultProps {
  assessment: SimulationAssessment;
  isOutdated: boolean;
}

export const SimulationResult: React.FC<SimulationResultProps> = ({ assessment, isOutdated }) => {
  const { request, response: result, origin } = assessment;
  const breakdown = origin === "backend" ? getSimulationEnergyBreakdown(result) : null;
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
      <Text accessibilityRole="header" style={styles.resultTitle}>Route assessment — {result.vehicle_id}</Text>
      {isOutdated && (
        <Text accessibilityRole="alert" style={styles.outdatedNotice}>
          Outdated result — inputs or vehicle state changed. Assess again to update.
        </Text>
      )}
      <Text style={styles.detailRow}>
        {origin === "local" ? "Offline demo estimate · Simplified local model" : "Backend assessment · Heuristic PoC model"}
      </Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Submitted conditions</Text>
      {formatSimulationConditions(request).map(line => <Text key={line} style={styles.detailRow}>{line}</Text>)}
      <Text style={styles.detailRow}>{formatBatteryState(result)}</Text>
      <Text style={styles.detailRow}>
        Starting SOC: {result.starting_soc_pct.toFixed(1)}% · SOH: {result.starting_soh_pct.toFixed(1)}%
      </Text>
      <View style={[styles.riskBadge, getBadgeStyle()]}>
        <Text style={[styles.riskText, getTextStyle()]}>{result.risk_level.replaceAll("_", " ")}</Text>
      </View>
      <Text style={styles.detailRow}>
        Projected Arrival SOC: {result.projected_arrival_soc_pct.toFixed(1)}%
      </Text>
      <Text style={styles.detailRow}>
        Net consumption: {result.estimated_energy_consumption_kwh.toFixed(2)} kWh
      </Text>
      <Text style={styles.detailRow}>
        Remaining Range: {result.remaining_range_km.toFixed(1)} km
      </Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Route energy</Text>
      {breakdown ? (
        <>
          {breakdown.map(component => (
            <View key={component.label} style={styles.energyRow}>
              <Text style={styles.detailRow}>{component.label}{component.recovered ? " (subtract)" : ""}</Text>
              <Text style={styles.detailRow}>{component.value.toFixed(2)} kWh</Text>
            </View>
          ))}
          <Text style={styles.note}>Components are rounded separately; their sum may differ slightly from net consumption.</Text>
        </>
      ) : <Text style={styles.note}>Energy breakdown unavailable for this estimate.</Text>}
      {origin === "backend" ? (
        <>
          <Text style={styles.detailRow}>Heuristic confidence: {result.confidence_score_pct.toFixed(0)}%</Text>
          <Text style={styles.note}>Confidence is a fixed rule score, not a calibrated completion probability.</Text>
        </>
      ) : (
        <Text style={styles.note}>
          Confidence unavailable for offline estimates. This estimate excludes temperature,
          SOH scaling, road type, descent, and regen. Connect to the backend to assess those inputs.
        </Text>
      )}
      <Text accessibilityRole="header" style={styles.sectionTitle}>Recommendations</Text>
      {result.recommendations.map((recommendation, index) => (
        <Text key={index} style={styles.detailRow}>• {recommendation}</Text>
      ))}
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
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: 12,
    marginBottom: 6,
  },
  outdatedNotice: {
    color: colors.riskCautionText,
    backgroundColor: colors.riskCautionBg,
    padding: 10,
    marginBottom: 8,
    borderRadius: 6,
  },
  energyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    gap: 8,
  },
  note: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: 8,
  },
});
