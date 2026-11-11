import React, { useEffect, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { formatBatteryState } from "@fleet/api-client";
import type { RiskLevel, SimulationRecord, TelemetryEvent, Vehicle } from "@fleet/api-client";
import { client } from "../config/api";
import { colors } from "../constants/theme";
import { Header } from "../components";
import type { TabType } from "../navigation";

interface DashboardScreenProps {
  vehicles: Vehicle[];
  telemetry?: Record<string, TelemetryEvent>;
  selectedVehicle?: Vehicle | null;
  dataStatus?: "demo" | "live" | "cached";
  onNavigateTab: (tab: TabType) => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}

const LOW_CHARGE_PCT = 30;
const HISTORY_LIMIT = 10;

const STATUS_ROWS = [
  { key: "AVAILABLE", label: "Available", color: colors.accentGreen },
  { key: "IN_USE", label: "In use", color: colors.accentCyan },
  { key: "CHARGING", label: "Charging", color: colors.accentYellow },
  { key: "MAINTENANCE", label: "Maintenance", color: colors.accentRed },
] as const;

const RISK_STYLE: Record<RiskLevel, { label: string; fg: string; bg: string }> = {
  SAFE: { label: "SAFE", fg: colors.riskSafeText, bg: colors.riskSafeBg },
  CAUTION: { label: "CAUTION", fg: colors.riskCautionText, bg: colors.riskCautionBg },
  NOT_RECOMMENDED: { label: "NOT RECOMMENDED", fg: colors.riskDangerText, bg: colors.riskDangerBg },
};

function statusColor(status: string): string {
  return STATUS_ROWS.find((row) => row.key === status)?.color ?? colors.textMuted;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  vehicles,
  telemetry = {},
  selectedVehicle = null,
  dataStatus = "live",
  onNavigateTab,
  onSelectVehicle,
  refreshing = false,
  onRefresh,
}) => {
  const total = vehicles.length;
  const reporting = vehicles.filter((v) => telemetry[v.id] !== undefined).length;
  const withPosition = vehicles.filter((v) => {
    const t = telemetry[v.id];
    return t?.latitude != null && t?.longitude != null;
  }).length;
  const avg = (pick: (v: Vehicle) => number) =>
    total ? vehicles.reduce((sum, v) => sum + pick(v), 0) / total : null;
  const avgSoc = avg((v) => v.current_soc);
  const avgSoh = avg((v) => v.current_soh);
  const lowCharge = vehicles.filter((v) => v.current_soc < LOW_CHARGE_PCT).length;
  const maintenance = vehicles.filter((v) => v.status === "MAINTENANCE").length;
  const statusCounts = STATUS_ROWS.map((row) => ({
    ...row,
    count: vehicles.filter((v) => v.status === row.key).length,
  }));

  const current = selectedVehicle ?? vehicles[0] ?? null;
  const currentId = current?.id ?? null;
  const [records, setRecords] = useState<SimulationRecord[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentId || dataStatus === "demo") {
      setRecords([]);
      setHistoryError(null);
      return;
    }
    let cancelled = false;
    client
      .getSimulationHistory(currentId)
      .then((data) => {
        if (cancelled) return;
        setRecords(data.slice(0, HISTORY_LIMIT));
        setHistoryError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecords([]);
        setHistoryError(err instanceof Error ? err.message : "Unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [currentId, dataStatus, refreshing]);

  const kpis: { label: string; value: string; sub: string; tone?: string }[] = [
    {
      label: "Vehicles",
      value: String(total),
      sub: `${reporting} reporting telemetry`,
    },
    {
      label: "Avg charge",
      value: avgSoc === null ? "—" : `${avgSoc.toFixed(1)}%`,
      sub: "State of charge",
    },
    {
      label: "Avg battery health",
      value: avgSoh === null ? "—" : `${avgSoh.toFixed(1)}%`,
      sub: "State of health",
    },
    {
      label: "Low charge",
      value: total ? String(lowCharge) : "—",
      sub: `Below ${LOW_CHARGE_PCT}% SOC`,
      tone: lowCharge > 0 ? colors.accentYellow : undefined,
    },
    {
      label: "In maintenance",
      value: total ? String(maintenance) : "—",
      sub: "Unavailable for trips",
      tone: maintenance > 0 ? colors.accentRed : undefined,
    },
  ];

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
        title="Dashboard"
        subtitle="Current battery state, status and positions across the fleet."
        showNavIcons={false}
      />

      {dataStatus === "demo" ? (
        <Text style={styles.demoNote}>
          Demo fleet data — connect to the fleet backend to see live vehicles.
        </Text>
      ) : null}

      <View style={styles.statsGrid}>
        {kpis.map((kpi) => (
          <View key={kpi.label} style={styles.statCard}>
            <Text style={styles.statLabel}>{kpi.label}</Text>
            <Text style={[styles.statValue, kpi.tone ? { color: kpi.tone } : null]}>
              {kpi.value}
            </Text>
            <Text style={styles.statSub}>{kpi.sub}</Text>
          </View>
        ))}
      </View>

      {total === 0 ? (
        <View style={styles.onboarding}>
          <MaterialCommunityIcons name="garage-variant" size={28} color={colors.accentPrimary} />
          <Text style={styles.onboardingTitle}>No vehicles registered yet</Text>
          <Text style={styles.onboardingText}>
            1. Open the garage and pick a model.{"\n"}
            2. Enter an ID, name, SOC and SOH.{"\n"}
            3. Plan a trip or watch the fleet update here.
          </Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => onNavigateTab("garage")}
            activeOpacity={0.8}
          >
            <Text style={styles.primaryButtonText}>Open garage</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <TouchableOpacity
        style={styles.actionBanner}
        onPress={() => onNavigateTab("planner")}
        activeOpacity={0.8}
      >
        <View style={styles.actionBannerLeft}>
          <View style={styles.bannerIconWrapper}>
            <MaterialCommunityIcons name="leaf-circle" size={28} color={colors.accentGreen} />
          </View>
          <View style={styles.actionBannerText}>
            <Text style={styles.bannerTitle}>Trip planner</Text>
            <Text style={styles.bannerSubtitle}>
              Estimate arrival SOC with route conditions, payload & elevation
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
      </TouchableOpacity>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>FLEET STATUS</Text>
          <Text style={styles.panelBadge}>
            {total} {total === 1 ? "VEHICLE" : "VEHICLES"}
          </Text>
        </View>
        {statusCounts.map((row) => (
          <View key={row.key} style={styles.statusRow}>
            <Text style={styles.statusLabel}>{row.label.toUpperCase()}</Text>
            <View style={styles.statusTrack}>
              <View
                style={[
                  styles.statusFill,
                  {
                    width: `${total ? (row.count / total) * 100 : 0}%`,
                    backgroundColor: row.color,
                  },
                ]}
              />
            </View>
            <Text style={styles.statusCount}>{row.count}</Text>
          </View>
        ))}
        <Text style={styles.note}>
          {withPosition > 0
            ? `${withPosition} of ${total} reporting a position.`
            : "No vehicle positions reported yet."}
        </Text>
      </View>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Vehicles</Text>
        <TouchableOpacity onPress={() => onNavigateTab("vehicles")}>
          <Text style={styles.sectionLink}>View all ({total})</Text>
        </TouchableOpacity>
      </View>

      {total === 0 ? <Text style={styles.note}>No vehicles registered yet.</Text> : null}

      {vehicles.map((vehicle) => {
        const isLow = vehicle.current_soc < LOW_CHARGE_PCT;
        const isSelected = vehicle.id === currentId;
        return (
          <TouchableOpacity
            key={vehicle.id}
            style={[styles.vehicleRow, isSelected && styles.vehicleRowSelected]}
            onPress={() => onSelectVehicle(vehicle)}
            activeOpacity={0.7}
          >
            <View style={styles.vehicleRowTop}>
              <Text style={styles.vehicleRowName} numberOfLines={1}>
                {vehicle.name || vehicle.id}
              </Text>
              <View style={[styles.pill, { borderColor: statusColor(vehicle.status) }]}>
                <Text style={[styles.pillText, { color: statusColor(vehicle.status) }]}>
                  {vehicle.status.replace("_", " ")}
                </Text>
              </View>
            </View>
            <Text style={styles.vehicleRowModel} numberOfLines={1}>
              {vehicle.model} · {vehicle.battery_capacity_kwh} kWh
            </Text>
            <Text style={styles.vehicleRowModel}>{formatBatteryState(vehicle)}</Text>
            <View style={styles.socTrack}>
              <View
                style={[
                  styles.socFill,
                  {
                    width: `${Math.max(0, Math.min(100, vehicle.current_soc))}%`,
                    backgroundColor: isLow ? colors.accentYellow : colors.accentGreen,
                  },
                ]}
              />
            </View>
            <View style={styles.socLabels}>
              <Text style={styles.vehicleRowModel}>{vehicle.current_soc}% SOC</Text>
              <Text style={styles.vehicleRowModel}>{vehicle.current_soh}% SOH</Text>
            </View>
          </TouchableOpacity>
        );
      })}

      <View style={[styles.panel, styles.assessments]}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>
            RECENT ASSESSMENTS{current ? ` — ${current.name || current.id}` : ""}
          </Text>
        </View>
        {!current ? (
          <Text style={styles.note}>Select a vehicle to see its saved assessments.</Text>
        ) : dataStatus === "demo" ? (
          <Text style={styles.note}>Saved assessments need the fleet backend.</Text>
        ) : historyError ? (
          <Text style={styles.errorNote}>Assessment history unavailable: {historyError}</Text>
        ) : records.length === 0 ? (
          <Text style={styles.note}>No saved assessments for this vehicle yet.</Text>
        ) : (
          records.map((record) => {
            const risk = RISK_STYLE[record.response.risk_level];
            return (
              <View key={record.id} style={styles.recordRow}>
                <View style={styles.recordMain}>
                  <Text style={styles.recordTitle}>
                    {record.request.route_distance_km} km → arrive at{" "}
                    {record.response.projected_arrival_soc_pct.toFixed(1)}%
                  </Text>
                  <Text style={styles.vehicleRowModel}>
                    {new Date(record.timestamp).toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.riskBadge, { backgroundColor: risk.bg }]}>
                  <Text style={[styles.riskText, { color: risk.fg }]}>{risk.label}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  demoNote: {
    fontSize: 12,
    color: colors.riskCautionText,
    backgroundColor: colors.riskCautionBg,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
    marginBottom: 6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  statSub: {
    fontSize: 11,
    color: colors.textMuted,
  },
  onboarding: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    padding: 16,
    gap: 8,
    marginBottom: 16,
  },
  onboardingTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  onboardingText: {
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  primaryButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.accentPrimary,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginTop: 4,
  },
  primaryButtonText: {
    color: "#001018",
    fontWeight: "700",
    fontSize: 13,
  },
  actionBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bgSurfaceAlt,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.accentPrimarySubtle,
    marginBottom: 16,
  },
  actionBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  bannerIconWrapper: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: colors.badgeBg,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  actionBannerText: {
    flex: 1,
  },
  bannerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  bannerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  panel: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 14,
    marginBottom: 16,
  },
  assessments: {
    marginTop: 6,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 10,
  },
  panelTitle: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    color: colors.textPrimary,
    letterSpacing: 0.5,
  },
  panelBadge: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.accentCyan,
    letterSpacing: 0.4,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 8,
  },
  statusLabel: {
    width: 92,
    fontSize: 10,
    color: colors.textSecondary,
    letterSpacing: 0.4,
  },
  statusTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bgSurfaceAlt,
    overflow: "hidden",
  },
  statusFill: {
    height: "100%",
    borderRadius: 3,
  },
  statusCount: {
    width: 20,
    textAlign: "right",
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  note: {
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
    marginTop: 4,
  },
  errorNote: {
    fontSize: 12,
    color: colors.errorText,
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    padding: 10,
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  sectionLink: {
    fontSize: 13,
    color: colors.accentPrimary,
    fontWeight: "600",
  },
  vehicleRow: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    gap: 3,
  },
  vehicleRowSelected: {
    borderColor: colors.borderSelected,
  },
  vehicleRowTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  vehicleRowName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  vehicleRowModel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  socTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.bgSurfaceAlt,
    overflow: "hidden",
    marginTop: 6,
  },
  socFill: {
    height: "100%",
    borderRadius: 3,
  },
  socLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  recordRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.borderColor,
  },
  recordMain: {
    flex: 1,
    gap: 2,
  },
  recordTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  riskBadge: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  riskText: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
});
