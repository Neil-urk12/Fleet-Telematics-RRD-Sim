import React, { useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { formatBatteryHistory } from "@fleet/api-client";
import type { Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";

interface BatteryScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onNavigateTab?: (tab: any) => void;
}

const MONTHS = ["MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP"] as const;
const SOH_Y_TICKS = [84, 88, 92, 96, 100];
const SOH_MIN = 82;
const SOH_MAX = 100;
const VEHICLE_COLORS = ["#00c2ff", "#10b981", "#f59e0b", "#a78bfa", "#ef4444", "#f97316"];

const SOH_HISTORY: Record<string, number[]> = {
  "EV-001": [97.8, 97.5, 97.1, 96.8, 96.5, 96.3, 96.1],
  "EV-002": [94.2, 93.6, 93.1, 92.5, 92.0, 91.6, 91.3],
  "EV-003": [91.8, 91.2, 90.6, 90.0, 89.5, 89.1, 88.7],
  "EV-004": [99.1, 98.8, 98.5, 98.1, 97.8, 97.6, 97.4],
  "EV-005": [87.9, 87.1, 86.4, 85.8, 85.2, 84.7, 84.2],
  "EV-006": [96.0, 95.5, 95.1, 94.7, 94.3, 94.0, 93.8],
};

const BASE_REGEN_SEED: Record<string, { regenKwh: number; brakeKwh: number }> = {
  "EV-001": { regenKwh: 8.4, brakeKwh: 1.8 },
  "EV-002": { regenKwh: 6.2, brakeKwh: 2.9 },
  "EV-003": { regenKwh: 4.1, brakeKwh: 3.7 },
  "EV-004": { regenKwh: 9.1, brakeKwh: 1.2 },
  "EV-005": { regenKwh: 2.3, brakeKwh: 4.5 },
  "EV-006": { regenKwh: 7.6, brakeKwh: 2.1 },
};

const REGEN_LEVEL = "MEDIUM";
const REGEN_MULTIPLIER = 1.0;
const BASELINE_PACK_TEMP_C = 31.5;
const PLAYBACK_FRACTION = 0.48;
const SUMMIT_FRACTION = 0.72;

function formatReportedHistory(vehicle: Vehicle): string {
  const parts: string[] = [];
  parts.push(vehicle.cycle_count == null ? "cycles not reported" : `${vehicle.cycle_count} cycles`);
  parts.push(vehicle.avg_dod_pct == null ? "DoD not reported" : `DoD ${vehicle.avg_dod_pct}%`);
  parts.push(
    vehicle.fast_charge_share_pct == null
      ? "fast-charge not reported"
      : `fast-charge ${vehicle.fast_charge_share_pct}%`
  );
  parts.push(
    vehicle.thermal_stress_index == null
      ? "thermal not reported"
      : `thermal ${vehicle.thermal_stress_index}`
  );
  return parts.join(" · ");
}

function sohHistoryFor(vehicle: Vehicle): number[] {
  if (SOH_HISTORY[vehicle.id]) return SOH_HISTORY[vehicle.id];
  const end = Math.max(SOH_MIN, Math.min(SOH_MAX, vehicle.current_soh ?? 96));
  return Array.from({ length: MONTHS.length }, (_, i) =>
    Math.round((end + (MONTHS.length - 1 - i) * 0.35) * 10) / 10
  );
}

function buildThermalGrid(baseTempC: number): number[][] {
  const loadBonus = 0;
  const climbHeat = PLAYBACK_FRACTION > 0 && PLAYBACK_FRACTION < SUMMIT_FRACTION ? 2.8 : 0;
  const effectiveBase = baseTempC + loadBonus + climbHeat;
  return Array.from({ length: 4 }, (_, r) =>
    Array.from({ length: 6 }, (_, c) => {
      const centerDist = Math.hypot(r - 1.5, c - 2.5);
      const moduleOffset = (2.8 - centerDist) * 1.4;
      const variation = ((r * 6 + c) % 5) * 0.4 - 1.0;
      return Math.round((effectiveBase + moduleOffset + variation) * 10) / 10;
    })
  );
}

function tempToColor(temp: number, min: number, max: number): string {
  const range = Math.max(max - min, 1);
  const ratio = Math.max(0, Math.min(1, (temp - min) / range));
  const hue = 200 * (1 - ratio);
  const saturation = 65 + ratio * 25;
  const lightness = 38 + ratio * 16;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function findHotspot(grid: number[][]): { row: number; col: number; temp: number } {
  let best = { row: 0, col: 0, temp: -Infinity };
  grid.forEach((row, r) =>
    row.forEach((temp, c) => {
      if (temp > best.temp) best = { row: r, col: c, temp };
    })
  );
  return best;
}

function LineSegment({
  x1,
  y1,
  x2,
  y2,
  color,
  thickness,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  thickness: number;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (length < 0.5) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        left: x1 + dx / 2 - length / 2,
        top: y1 + dy / 2 - thickness / 2,
        width: length,
        height: thickness,
        backgroundColor: color,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

export const BatteryScreen: React.FC<BatteryScreenProps> = ({
  vehicles,
  selectedVehicle,
  onSelectVehicle,
  onNavigateTab,
}) => {
  const current = selectedVehicle ?? vehicles[0] ?? null;
  const [pressedCell, setPressedCell] = useState<{
    row: number;
    col: number;
    temp: number;
  } | null>(null);
  const [chartWidth, setChartWidth] = useState(0);

  const thermalGrid = useMemo(() => buildThermalGrid(BASELINE_PACK_TEMP_C), []);
  const allTemps = thermalGrid.flat();
  const maxTemp = Math.max(...allTemps);
  const minTemp = Math.min(...allTemps);
  const avgTemp = allTemps.reduce((sum, t) => sum + t, 0) / allTemps.length;
  const tempSpread = maxTemp - minTemp;
  const hotspot = findHotspot(thermalGrid);
  const thermalStatus = maxTemp > 45 ? "CRITICAL" : maxTemp > 40 ? "WARNING" : "NOMINAL";
  const statusColor =
    maxTemp > 45 ? colors.accentRed : maxTemp > 40 ? colors.accentYellow : colors.accentGreen;

  const sohSeries = useMemo(
    () =>
      vehicles.slice(0, 6).map((vehicle, index) => ({
        vehicle,
        history: sohHistoryFor(vehicle),
        color: VEHICLE_COLORS[index % VEHICLE_COLORS.length],
      })),
    [vehicles]
  );

  const regenData = useMemo(
    () =>
      vehicles.map((vehicle) => {
        const base = BASE_REGEN_SEED[vehicle.id] ?? { regenKwh: 5, brakeKwh: 2 };
        return {
          id: vehicle.id,
          regenKwh: base.regenKwh * REGEN_MULTIPLIER,
          brakeKwh: base.brakeKwh / REGEN_MULTIPLIER,
        };
      }),
    [vehicles]
  );
  const totalRegen = regenData.reduce((sum, row) => sum + row.regenKwh, 0);
  const totalBrake = regenData.reduce((sum, row) => sum + row.brakeKwh, 0);
  const capturePct = (totalRegen / (totalRegen + totalBrake || 1)) * 100;
  const regenMax = Math.max(...regenData.map((row) => row.regenKwh + row.brakeKwh), 12);

  if (!current || vehicles.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyTitle}>No vehicles yet</Text>
        <Text style={styles.emptySubtitle}>
          Add your first vehicle to see fleet data, plan trips and view battery details.
        </Text>
        <TouchableOpacity
          style={styles.emptyButton}
          onPress={() => onNavigateTab?.("vehicles")}
          activeOpacity={0.8}
        >
          <Text style={styles.emptyButtonText}>Add a vehicle</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const chartInnerWidth = Math.max(0, chartWidth - 36 - 78);
  const chartHeight = 168;
  const xAt = (i: number) => 36 + (chartInnerWidth * i) / (MONTHS.length - 1);
  const yAt = (soh: number) =>
    8 + ((SOH_MAX - soh) / (SOH_MAX - SOH_MIN)) * (chartHeight - 28);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.headerTitle}>Battery</Text>
          <Text style={styles.headerSubtitle}>
            Illustrative pack temperature, health history and regen estimates.
          </Text>
        </View>
      </View>

      <View style={styles.vehiclePicker}>
        <Text style={styles.vehiclePickerLabel}>Vehicle</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.vehicleScroll}
        >
          {vehicles.map((vehicle) => {
            const selected = vehicle.id === current.id;
            return (
              <TouchableOpacity
                key={vehicle.id}
                style={[styles.vehicleChip, selected && styles.vehicleChipSelected]}
                onPress={() => onSelectVehicle(vehicle)}
                activeOpacity={0.8}
              >
                <Text
                  style={[styles.vehicleChipText, selected && styles.vehicleChipTextSelected]}
                  numberOfLines={1}
                >
                  {vehicle.id} · {vehicle.name || vehicle.model || "Vehicle"}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>ILLUSTRATIVE PACK THERMAL GRID</Text>
          <Text style={[styles.panelBadge, { color: statusColor }]}>● {thermalStatus}</Text>
        </View>
        <Text style={styles.dataNote}>
          Pack temperature unavailable · Illustrative baseline {BASELINE_PACK_TEMP_C.toFixed(1)}°C.
          Module temperatures and thermal status are local estimates.
        </Text>

        <View style={styles.thermalGrid}>
          {thermalGrid.map((row, r) => (
            <View key={`row-${r}`} style={styles.thermalRow}>
              {row.map((temp, c) => {
                const isHot = r === hotspot.row && c === hotspot.col;
                const isPressed = pressedCell?.row === r && pressedCell?.col === c;
                return (
                  <TouchableOpacity
                    key={`${r}-${c}`}
                    style={[
                      styles.thermalCell,
                      { backgroundColor: tempToColor(temp, minTemp, maxTemp) },
                      isHot && styles.thermalCellHot,
                      isPressed && styles.thermalCellPressed,
                    ]}
                    onPress={() =>
                      setPressedCell((prev) =>
                        prev?.row === r && prev?.col === c ? null : { row: r, col: c, temp }
                      )
                    }
                    activeOpacity={0.85}
                  >
                    <Text style={styles.thermalCellValue}>{temp.toFixed(0)}°</Text>
                    {isHot ? <Text style={styles.hotLabel}>HOT</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          ))}
        </View>

        {pressedCell ? (
          <Text style={styles.tooltip}>
            Module [{pressedCell.row + 1},{pressedCell.col + 1}]: {pressedCell.temp.toFixed(1)}°C (
            {pressedCell.temp - avgTemp >= 0 ? "+" : ""}
            {(pressedCell.temp - avgTemp).toFixed(1)}° vs avg)
          </Text>
        ) : null}

        <View style={styles.rampRow}>
          <Text style={styles.rampLabel}>{minTemp.toFixed(0)}°C</Text>
          <View style={styles.rampBar}>
            <View style={[styles.rampStop, { backgroundColor: "hsl(200, 65%, 40%)" }]} />
            <View style={[styles.rampStop, { backgroundColor: "hsl(120, 75%, 45%)" }]} />
            <View style={[styles.rampStop, { backgroundColor: "hsl(60, 85%, 50%)" }]} />
            <View style={[styles.rampStop, { backgroundColor: "hsl(0, 90%, 55%)" }]} />
          </View>
          <Text style={styles.rampLabel}>{maxTemp.toFixed(0)}°C</Text>
        </View>

        <View style={styles.thermalStats}>
          <View style={styles.thermalStat}>
            <Text style={styles.statLabel}>MAX TEMP</Text>
            <Text
              style={[
                styles.statValue,
                { color: maxTemp > 40 ? colors.accentRed : colors.textPrimary },
              ]}
            >
              {maxTemp.toFixed(1)}°C
            </Text>
          </View>
          <View style={styles.thermalStat}>
            <Text style={styles.statLabel}>HOTSPOT</Text>
            <Text style={[styles.statValue, { color: colors.accentYellow }]}>
              M[{hotspot.row + 1},{hotspot.col + 1}]
            </Text>
          </View>
          <View style={styles.thermalStat}>
            <Text style={styles.statLabel}>AVG TEMP</Text>
            <Text style={styles.statValue}>{avgTemp.toFixed(1)}°C</Text>
          </View>
          <View style={styles.thermalStat}>
            <Text style={styles.statLabel}>SPREAD (ΔT)</Text>
            <Text
              style={[
                styles.statValue,
                { color: tempSpread > 8 ? colors.accentRed : colors.accentCyan },
              ]}
            >
              {tempSpread.toFixed(1)}°C
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>DEMO SOH HISTORY — 7 MONTHS</Text>
          <Text style={[styles.panelBadge, { color: colors.accentYellow }]}>
            ILLUSTRATIVE TRENDS
          </Text>
        </View>
        <Text style={styles.dataNote}>
          Fixed example history. Current SOH and reading age appear in the fleet list.
        </Text>

        <View
          style={[styles.sohChart, { height: chartHeight }]}
          onLayout={(event) => setChartWidth(event.nativeEvent.layout.width)}
        >
          {SOH_Y_TICKS.map((tick) => (
            <View key={tick} style={[styles.sohGridRow, { top: yAt(tick) }]}>
              <Text style={styles.sohYLabel}>{tick}%</Text>
              <View style={styles.sohGridLine} />
            </View>
          ))}
          <View style={[styles.sohWarnRow, { top: yAt(90) }]}>
            <View style={styles.sohWarnLine} />
            <Text style={styles.sohWarnLabel}>90% SOH THRESHOLD</Text>
          </View>
          {chartInnerWidth > 0
            ? sohSeries.map(({ vehicle, history, color }) => {
                const selected = vehicle.id === current.id;
                const stroke = selected ? colors.accentCyan : color;
                return (
                  <View key={vehicle.id} style={StyleSheet.absoluteFill} pointerEvents="none">
                    {history.slice(1).map((soh, index) => (
                      <LineSegment
                        key={`${vehicle.id}-${index}`}
                        x1={xAt(index)}
                        y1={yAt(history[index])}
                        x2={xAt(index + 1)}
                        y2={yAt(soh)}
                        color={stroke}
                        thickness={selected ? 2.5 : 1.5}
                      />
                    ))}
                    {history.map((soh, index) => (
                      <View
                        key={`${vehicle.id}-dot-${index}`}
                        style={[
                          styles.sohDot,
                          {
                            left: xAt(index) - (selected ? 4 : 3),
                            top: yAt(soh) - (selected ? 4 : 3),
                            width: selected ? 8 : 6,
                            height: selected ? 8 : 6,
                            borderRadius: selected ? 4 : 3,
                            backgroundColor: stroke,
                            opacity: selected ? 1 : 0.7,
                          },
                        ]}
                      />
                    ))}
                    <Text
                      style={[
                        styles.sohEndLabel,
                        {
                          left: xAt(history.length - 1) + 6,
                          top: yAt(history[history.length - 1]) - 7,
                          color: stroke,
                          fontWeight: selected ? "700" : "500",
                        },
                      ]}
                    >
                      {vehicle.id} {history[history.length - 1].toFixed(1)}%
                    </Text>
                  </View>
                );
              })
            : null}
          <View style={styles.sohMonths}>
            {MONTHS.map((month) => (
              <Text key={month} style={styles.sohMonth}>
                {month}
              </Text>
            ))}
          </View>
        </View>

        <Text style={styles.dataNote}>
          {current.id} reported history: {formatReportedHistory(current)} ·{" "}
          {formatBatteryHistory(current.battery_history)}
        </Text>
      </View>

      <View style={styles.panel}>
        <View style={styles.panelHeader}>
          <Text style={styles.panelTitle}>DEMO REGEN & BRAKING ESTIMATE</Text>
          <Text style={[styles.panelBadge, { color: colors.accentGreen }]}>
            ● {capturePct.toFixed(0)}% CAPTURE ({REGEN_LEVEL})
          </Text>
        </View>
        <Text style={styles.dataNote}>
          Illustrative values based on the regen setting. Fleet recovery and brake losses are not
          measured.
        </Text>

        <View style={styles.regenStatsRow}>
          <View style={styles.regenStat}>
            <Text style={styles.statLabel}>EXAMPLE RECOVERY</Text>
            <Text style={[styles.statValue, { color: colors.accentGreen }]}>
              +{totalRegen.toFixed(1)} kWh
            </Text>
          </View>
          <View style={styles.regenStat}>
            <Text style={styles.statLabel}>EXAMPLE BRAKE LOSS</Text>
            <Text style={[styles.statValue, { color: colors.accentRed }]}>
              -{totalBrake.toFixed(1)} kWh
            </Text>
          </View>
          <View style={styles.regenStat}>
            <Text style={styles.statLabel}>EXAMPLE RANGE BOOST</Text>
            <Text style={[styles.statValue, { color: colors.accentCyan }]}>
              +{(totalRegen * 5.8).toFixed(0)} km
            </Text>
          </View>
        </View>

        {regenData.map((row) => {
          const selected = row.id === current.id;
          const regenPct = Math.max(4, (row.regenKwh / regenMax) * 100);
          const brakePct = Math.max(4, (row.brakeKwh / regenMax) * 100);
          return (
            <View
              key={row.id}
              style={[styles.regenRow, selected && styles.regenRowSelected]}
            >
              <Text style={[styles.regenId, selected && styles.regenIdSelected]} numberOfLines={1}>
                {row.id}
              </Text>
              <View style={styles.regenBars}>
                <View style={[styles.regenBar, { width: `${regenPct}%` }]} />
                <View style={[styles.brakeBar, { width: `${brakePct}%` }]} />
              </View>
              <Text style={[styles.regenValue, selected && styles.regenValueSelected]}>
                +{row.regenKwh.toFixed(1)} kWh
              </Text>
            </View>
          );
        })}

        <View style={styles.regenLegend}>
          <Text style={[styles.legendItem, { color: colors.accentGreen }]}>
            ■ Kinetic Harvest (Regen)
          </Text>
          <Text style={[styles.legendItem, { color: colors.accentRed }]}>
            ■ Thermal Loss (Pads)
          </Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingBottom: 28,
  },
  pageHeader: {
    paddingTop: 12,
    paddingBottom: 10,
  },
  pageHeaderText: {
    gap: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  vehiclePicker: {
    marginBottom: 12,
  },
  vehiclePickerLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: colors.textMuted,
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  vehicleScroll: {
    gap: 8,
  },
  vehicleChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: colors.bgPanel,
    borderWidth: 1,
    borderColor: colors.borderColor,
    maxWidth: 260,
  },
  vehicleChipSelected: {
    borderColor: colors.accentCyan,
    backgroundColor: "rgba(0, 194, 255, 0.12)",
  },
  vehicleChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  vehicleChipTextSelected: {
    color: colors.accentCyan,
    fontWeight: "600",
  },
  panel: {
    backgroundColor: colors.bgPanel,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 12,
    marginBottom: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 6,
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
    letterSpacing: 0.4,
  },
  dataNote: {
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: 10,
  },
  thermalGrid: {
    gap: 3,
  },
  thermalRow: {
    flexDirection: "row",
    gap: 3,
  },
  thermalCell: {
    flex: 1,
    aspectRatio: 1.45,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  thermalCellHot: {
    borderWidth: 2,
    borderColor: "rgba(239, 68, 68, 0.85)",
  },
  thermalCellPressed: {
    transform: [{ scale: 1.04 }],
  },
  thermalCellValue: {
    fontSize: 10,
    fontWeight: "700",
    color: "rgba(0, 0, 0, 0.8)",
  },
  hotLabel: {
    fontSize: 7,
    color: "#ffdddd",
    fontWeight: "700",
  },
  tooltip: {
    marginTop: 8,
    fontSize: 11,
    color: colors.textPrimary,
    fontFamily: "monospace",
    backgroundColor: "rgba(11, 19, 32, 0.95)",
    borderWidth: 1,
    borderColor: colors.accentCyan,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  rampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  rampLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontFamily: "monospace",
  },
  rampBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    overflow: "hidden",
    flexDirection: "row",
  },
  rampStop: {
    flex: 1,
    height: "100%",
  },
  thermalStats: {
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderColor,
    marginTop: 6,
  },
  thermalStat: {
    alignItems: "center",
    gap: 2,
  },
  statLabel: {
    fontSize: 9,
    color: colors.textMuted,
    letterSpacing: 0.4,
    fontWeight: "600",
  },
  statValue: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  sohChart: {
    position: "relative",
    marginBottom: 8,
    overflow: "hidden",
  },
  sohGridRow: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
  },
  sohYLabel: {
    width: 32,
    fontSize: 8,
    color: "#4a5568",
    textAlign: "right",
    marginRight: 4,
  },
  sohGridLine: {
    flex: 1,
    height: 1,
    borderStyle: "dashed",
    borderWidth: 0.5,
    borderColor: "rgba(30, 45, 61, 0.9)",
  },
  sohWarnRow: {
    position: "absolute",
    left: 36,
    right: 8,
  },
  sohWarnLine: {
    height: 1,
    borderStyle: "dashed",
    borderWidth: 0.5,
    borderColor: "rgba(245, 158, 11, 0.4)",
  },
  sohWarnLabel: {
    position: "absolute",
    left: 4,
    top: -12,
    fontSize: 8,
    color: "rgba(245, 158, 11, 0.7)",
  },
  sohDot: {
    position: "absolute",
  },
  sohEndLabel: {
    position: "absolute",
    fontSize: 8,
    fontFamily: "monospace",
  },
  sohMonths: {
    position: "absolute",
    left: 36,
    right: 8,
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sohMonth: {
    fontSize: 9,
    color: "#7a8ba6",
  },
  regenStatsRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 12,
    padding: 8,
    backgroundColor: colors.bgInput,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderColor,
  },
  regenStat: {
    flex: 1,
    gap: 2,
  },
  regenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  regenRowSelected: {
    backgroundColor: "rgba(0, 194, 255, 0.08)",
    borderRadius: 6,
  },
  regenId: {
    width: 72,
    fontSize: 10,
    color: "#7a8ba6",
    fontFamily: "monospace",
    textAlign: "right",
  },
  regenIdSelected: {
    color: colors.accentCyan,
    fontWeight: "700",
  },
  regenBars: {
    flex: 1,
    gap: 3,
  },
  regenBar: {
    height: 8,
    borderRadius: 2,
    backgroundColor: colors.accentGreen,
  },
  brakeBar: {
    height: 5,
    borderRadius: 2,
    backgroundColor: "rgba(239, 68, 68, 0.5)",
  },
  regenValue: {
    width: 72,
    fontSize: 10,
    fontWeight: "700",
    color: colors.accentGreen,
    fontFamily: "monospace",
  },
  regenValueSelected: {
    color: "#34d399",
  },
  regenLegend: {
    flexDirection: "row",
    gap: 14,
    marginTop: 8,
  },
  legendItem: {
    fontSize: 10,
    letterSpacing: 0.3,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: colors.accentCyan,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  emptyButtonText: {
    color: "#0a0e17",
    fontWeight: "700",
    fontSize: 13,
  },
});
