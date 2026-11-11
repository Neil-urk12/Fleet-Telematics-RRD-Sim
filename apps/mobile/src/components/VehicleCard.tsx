import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatBatteryState } from "@fleet/api-client";
import type { Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";

export function getStatusColor(status: string): string {
  switch (status) {
    case "AVAILABLE":
    case "ACTIVE":
      return colors.accentGreen;
    case "CHARGING":
      return colors.accentCyan;
    case "IN_USE":
      return colors.accentYellow;
    case "MAINTENANCE":
      return colors.accentRed;
    default:
      return colors.textMuted;
  }
}

export function getSocColor(soc: number): string {
  if (soc > 60) return colors.accentGreen;
  if (soc > 30) return colors.accentYellow;
  return colors.accentRed;
}

export interface VehicleCardProps {
  vehicle: Vehicle;
  isSelected: boolean;
  onSelect: (vehicle: Vehicle) => void;
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  isSelected,
  onSelect,
}) => {
  const statusColor = getStatusColor(vehicle.status);
  const socColor = getSocColor(vehicle.current_soc);

  return (
    <TouchableOpacity
      style={[styles.vehicleCard, isSelected && styles.vehicleCardSelected]}
      onPress={() => onSelect(vehicle)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`Select vehicle ${vehicle.id}`}
    >
      <View style={styles.topRow}>
        <Text style={styles.vehicleId}>{vehicle.id}</Text>
        <View style={[styles.statusBadge, { backgroundColor: statusColor }]}>
          <Text style={styles.statusBadgeText}>{vehicle.status.replace("_", " ")}</Text>
        </View>
      </View>

      <Text style={styles.vehicleModel}>{vehicle.model}</Text>
      <Text style={styles.vehicleProvenance}>{formatBatteryState(vehicle)}</Text>

      <View style={styles.socBarTrack}>
        <View
          style={[
            styles.socBarFill,
            {
              width: `${Math.max(2, Math.min(100, vehicle.current_soc))}%`,
              backgroundColor: socColor,
            },
          ]}
        />
      </View>

      <View style={styles.statsRow}>
        <Text style={styles.statText}>{vehicle.current_soc.toFixed(0)}%</Text>
        <Text style={styles.statText}>{vehicle.battery_capacity_kwh} kWh</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  vehicleCard: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.borderColor,
    padding: 12,
    marginBottom: 8,
  },
  vehicleCardSelected: {
    borderColor: colors.accentCyan,
    backgroundColor: "rgba(0, 194, 255, 0.08)",
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  vehicleId: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: "monospace",
    color: colors.textPrimary,
  },
  statusBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 9,
    fontWeight: "700",
    color: "#0a0e17",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  vehicleModel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  vehicleProvenance: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: 8,
  },
  socBarTrack: {
    height: 4,
    backgroundColor: colors.bgInput,
    borderRadius: 2,
    overflow: "hidden",
    marginBottom: 6,
  },
  socBarFill: {
    height: 4,
    borderRadius: 2,
  },
  statsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  statText: {
    fontSize: 11,
    fontFamily: "monospace",
    color: colors.textSecondary,
  },
});
