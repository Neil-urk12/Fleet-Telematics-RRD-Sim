import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { formatBatteryState } from "@fleet/api-client";
import type { Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";

interface VehicleDetailsProps {
  vehicle: Vehicle;
  loading: boolean;
  onRunSimulation: (vehicle: Vehicle) => void;
}

export const VehicleDetails: React.FC<VehicleDetailsProps> = ({
  vehicle,
  loading,
  onRunSimulation,
}) => {
  return (
    <View style={styles.detailsCard}>
      <Text style={styles.detailsTitle}>{vehicle.name} Details</Text>
      <Text style={styles.detailRow}>Battery: {vehicle.battery_capacity_kwh} kWh</Text>
      <Text style={styles.detailRow}>State of Health: {vehicle.current_soh}%</Text>
      <Text style={styles.detailRow}>Efficiency: {vehicle.baseline_efficiency_wh_km} Wh/km</Text>
      <Text style={styles.detailRow}>Status: {vehicle.status}</Text>
      <Text style={styles.detailRow}>{formatBatteryState(vehicle)}</Text>

      <TouchableOpacity
        style={styles.simulateButton}
        onPress={() => onRunSimulation(vehicle)}
        disabled={loading}
      >
        <Text style={styles.simulateButtonText}>
          {loading ? "Simulating..." : "Test 120km Route Simulation"}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  detailsCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 16,
  },
  detailsTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
    color: colors.textPrimary,
  },
  detailRow: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  simulateButton: {
    backgroundColor: colors.primary,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 12,
  },
  simulateButtonText: {
    color: colors.primaryText,
    fontWeight: "600",
    fontSize: 14,
  },
});
