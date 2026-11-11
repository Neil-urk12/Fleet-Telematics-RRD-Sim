import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { formatBatteryHistory, formatBatteryState, formatSimulationConditions, getSimulationEnergyBreakdown } from "@fleet/api-client";
import type { SimulationAssessment, SimulationResponse } from "@fleet/api-client";
import { colors } from "../constants/theme";

function getVerdict(result: SimulationResponse, reservePct: number) {
  const arrival = Math.floor(result.projected_arrival_soc_pct);
  const runsOut = result.projected_arrival_soc_pct < 0;
  if (result.risk_level === "SAFE") {
    return {
      mark: "✓",
      title: "Yes, you'll make it",
      detail: `You should arrive with about ${arrival}% battery, above your ${reservePct}% safety margin.`,
    };
  }
  if (result.risk_level === "CAUTION") {
    return {
      mark: "!",
      title: "You'll make it, but it's close",
      detail: `You should arrive with about ${arrival}% battery, below your ${reservePct}% safety margin.`,
    };
  }
  return {
    mark: "✕",
    title: runsOut ? "The battery runs out before you arrive" : "Charge before this trip",
    detail: runsOut
      ? `You'd be about ${Math.ceil(-result.projected_arrival_soc_pct)}% of a full battery short. Plan a charging stop or choose another vehicle.`
      : `Only about ${arrival}% battery would be left, well below your ${reservePct}% safety margin.`,
  };
}

interface SimulationResultProps {
  assessment: SimulationAssessment;
  isOutdated: boolean;
}

export const SimulationResult: React.FC<SimulationResultProps> = ({ assessment, isOutdated }) => {
  const { request, response: result, origin } = assessment;
  const breakdown = origin === "backend" ? getSimulationEnergyBreakdown(result) : null;
  const verdict = getVerdict(result, request.reserve_soc_target_pct ?? 15);
  const arrivalLabel = result.projected_arrival_soc_pct < 0 ? "Empty" : `${Math.floor(result.projected_arrival_soc_pct)}%`;
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
      {isOutdated && (
        <Text accessibilityRole="alert" style={styles.outdatedNotice}>
          You changed something since this result. Press Simulate trip again to update it.
        </Text>
      )}
      <View style={[styles.verdict, getBadgeStyle()]}>
        <Text style={[styles.verdictMark, getTextStyle()]}>{verdict.mark}</Text>
        <View style={styles.verdictCopy}>
          <Text style={styles.resultTitle}>{verdict.title}</Text>
          <Text style={styles.detailRow}>{verdict.detail}</Text>
          <Text style={styles.note}>{result.vehicle_id} · {origin === "local" ? "offline demo estimate" : "estimate from the backend model"}</Text>
        </View>
      </View>
      <View style={styles.statsRow}>
        <Text style={styles.detailRow}>Battery on arrival: {arrivalLabel}</Text>
        <Text style={styles.detailRow}>Range left after trip: {result.remaining_range_km.toFixed(0)} km</Text>
        <Text style={styles.detailRow}>Energy used: {result.estimated_energy_consumption_kwh.toFixed(1)} kWh</Text>
      </View>
      <Text accessibilityRole="header" style={styles.sectionTitle}>What you can do</Text>
      {result.recommendations.map((recommendation, index) => (
        <Text key={index} style={styles.detailRow}>• {recommendation}</Text>
      ))}
      <Text accessibilityRole="header" style={styles.sectionTitle}>How this was calculated</Text>
      <Text style={styles.detailRow}>
        {origin === "local" ? "Offline demo estimate · Simplified local model" : "Backend assessment · Heuristic PoC model"}
      </Text>
      <Text accessibilityRole="header" style={styles.sectionTitle}>Submitted conditions</Text>
      {formatSimulationConditions(request).map(line => <Text key={line} style={styles.detailRow}>{line}</Text>)}
      <Text style={styles.detailRow}>{formatBatteryState(result)}</Text>
      <Text style={styles.detailRow}>
        Starting SOC: {result.starting_soc_pct.toFixed(1)}% · SOH: {result.starting_soh_pct.toFixed(1)}%
      </Text>
      <Text style={styles.detailRow}>
        {origin === "local" ? "History stress not modelled in the offline estimate." : formatBatteryHistory(result.battery_history)}
      </Text>
      <Text style={styles.detailRow}>
        Arrival SOC: {result.projected_arrival_soc_pct.toFixed(1)}% · {result.risk_level.replaceAll("_", " ")}
      </Text>
      <Text style={styles.detailRow}>
        Net consumption: {result.estimated_energy_consumption_kwh.toFixed(2)} kWh
      </Text>
      <Text style={styles.detailRow}>
        Remaining Range: {result.remaining_range_km.toFixed(1)} km
      </Text>
      {result.arrival_soc_low_pct != null && result.arrival_soc_high_pct != null && (
        <Text style={styles.detailRow}>
          Likely arrival SOC: {result.arrival_soc_low_pct.toFixed(1)}–{result.arrival_soc_high_pct.toFixed(1)}%
        </Text>
      )}
      {result.predicted_range_low_km != null && result.predicted_range_high_km != null && (
        <Text style={styles.detailRow}>
          Range at departure: {result.predicted_range_low_km.toFixed(0)}–{result.predicted_range_high_km.toFixed(0)} km
        </Text>
      )}
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
          {result.uncertainty_pct != null ? (
            <>
              <Text style={styles.detailRow}>
                Chance of arriving above safety margin: {result.confidence_score_pct.toFixed(0)}% (energy ±{result.uncertainty_pct.toFixed(0)}%)
              </Text>
              <Text style={styles.note}>Uncertainty and chance are rule-of-thumb estimates, not calibrated against real trips.</Text>
            </>
          ) : (
            <>
              <Text style={styles.detailRow}>Heuristic confidence: {result.confidence_score_pct.toFixed(0)}%</Text>
              <Text style={styles.note}>Confidence is a fixed rule score, not a calibrated completion probability.</Text>
            </>
          )}
        </>
      ) : (
        <Text style={styles.note}>
          Confidence unavailable for offline estimates. This estimate excludes temperature,
          SOH scaling, road type, descent, regen, and battery history stress.
          Connect to the backend to assess those inputs.
        </Text>
      )}
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
  verdict: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  verdictMark: { fontSize: 22, fontWeight: "700" },
  verdictCopy: { flex: 1 },
  statsRow: { marginBottom: 4 },
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
