import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatBatteryState } from "@fleet/api-client";
import type { Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";

interface VehicleCardProps {
  vehicle: Vehicle;
  isSelected: boolean;
  onSelect: (vehicle: Vehicle) => void;
}

export const VehicleCard: React.FC<VehicleCardProps> = ({
  vehicle,
  isSelected,
  onSelect,
}) => {
  return (
    <TouchableOpacity
      style={[styles.vehicleCard, isSelected && styles.vehicleCardSelected]}
      onPress={() => onSelect(vehicle)}
    >
      <Text style={styles.vehicleName}>{vehicle.name}</Text>
      <Text style={styles.vehicleModel}>{vehicle.model}</Text>
      <Text style={styles.vehicleModel}>{formatBatteryState(vehicle)}</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>SOC: {vehicle.current_soc}%</Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  vehicleCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 14,
    marginRight: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    minWidth: 140,
  },
  vehicleCardSelected: {
    borderColor: colors.borderSelected,
    backgroundColor: colors.bgSelected,
  },
  vehicleName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  vehicleModel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 8,
  },
  badge: {
    backgroundColor: colors.badgeBg,
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    alignSelf: "flex-start",
  },
  badgeText: {
    color: colors.badgeText,
    fontSize: 12,
    fontWeight: "600",
  },
});
