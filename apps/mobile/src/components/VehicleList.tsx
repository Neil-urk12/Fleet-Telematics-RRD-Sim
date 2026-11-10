import React from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import type { Vehicle } from "@fleet/api-client";
import { VehicleCard } from "./VehicleCard";
import { colors } from "../constants/theme";

interface VehicleListProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  loading: boolean;
  onSelectVehicle: (vehicle: Vehicle) => void;
}

export const VehicleList: React.FC<VehicleListProps> = ({
  vehicles,
  selectedVehicle,
  loading,
  onSelectVehicle,
}) => {
  return (
    <View>
      <Text style={styles.sectionHeader}>Fleet Vehicles</Text>
      {loading && vehicles.length === 0 ? (
        <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
      ) : (
        <FlatList
          data={vehicles}
          keyExtractor={(item) => item.id}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.vehicleList}
          renderItem={({ item }) => (
            <VehicleCard
              vehicle={item}
              isSelected={selectedVehicle?.id === item.id}
              onSelect={onSelectVehicle}
            />
          )}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    fontSize: 16,
    fontWeight: "600",
    color: colors.heading,
    marginBottom: 10,
  },
  spinner: {
    marginTop: 20,
    marginBottom: 20,
  },
  vehicleList: {
    maxHeight: 180,
    marginBottom: 16,
  },
});
