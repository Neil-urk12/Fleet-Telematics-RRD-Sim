import React, { useState } from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";
import { Header, VehicleList, VehicleDetails, ErrorBanner } from "../components";
import type { TabType } from "../navigation";

interface FleetScreenProps {
  vehicles: Vehicle[];
  selectedVehicle: Vehicle | null;
  loading: boolean;
  error: string | null;
  onSelectVehicle: (vehicle: Vehicle) => void;
  onRefresh: () => void;
  onSimulateWithVehicle: (vehicle: Vehicle) => void;
  refreshing?: boolean;
}

export const FleetScreen: React.FC<FleetScreenProps> = ({
  vehicles,
  selectedVehicle,
  loading,
  error,
  onSelectVehicle,
  onRefresh,
  onSimulateWithVehicle,
  refreshing = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "IDLE">("ALL");

  const filteredVehicles = vehicles.filter((v) => {
    const matchesSearch =
      v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      v.model.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus =
      filterStatus === "ALL" || (v.status || "ACTIVE") === filterStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accentPrimary}
          colors={[colors.accentPrimary]}
          progressBackgroundColor={colors.bgSurface}
        />
      }
    >
      <Header
        title="Fleet Management"
        subtitle="Live Electric Commercial Vehicles"
      />

      {error && <ErrorBanner message={error} onRetry={onRefresh} />}

      {/* Search and Filters */}
      <View style={styles.searchBar}>
        <MaterialCommunityIcons
          name="magnify"
          size={20}
          color={colors.textMuted}
          style={styles.searchIcon}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search fleet by name or model..."
          placeholderTextColor={colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery("")}>
            <MaterialCommunityIcons
              name="close-circle"
              size={18}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Chips */}
      <View style={styles.filterRow}>
        {(["ALL", "ACTIVE", "IDLE"] as const).map((status) => (
          <TouchableOpacity
            key={status}
            style={[
              styles.filterChip,
              filterStatus === status && styles.filterChipActive,
            ]}
            onPress={() => setFilterStatus(status)}
          >
            <Text
              style={[
                styles.filterChipText,
                filterStatus === status && styles.filterChipTextActive,
              ]}
            >
              {status === "ALL" ? "All Fleet" : status}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Horizontal Vehicle Picker */}
      <VehicleList
        vehicles={filteredVehicles}
        selectedVehicle={selectedVehicle}
        loading={loading}
        onSelectVehicle={onSelectVehicle}
      />

      {/* Selected Vehicle In-Depth Specifications */}
      {selectedVehicle ? (
        <View style={styles.selectedWrapper}>
          <VehicleDetails
            vehicle={selectedVehicle}
            loading={loading}
            onRunSimulation={onSimulateWithVehicle}
          />

          {/* Additional Specs Card */}
          <View style={styles.specCard}>
            <Text style={styles.specTitle}>Powertrain & Battery Health</Text>
            
            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Current State of Charge</Text>
              <Text style={[styles.specVal, { color: colors.accentPrimary }]}>
                {selectedVehicle.current_soc}%
              </Text>
            </View>

            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Battery Capacity</Text>
              <Text style={styles.specVal}>
                {selectedVehicle.battery_capacity_kwh} kWh
              </Text>
            </View>

            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Baseline Efficiency</Text>
              <Text style={styles.specVal}>
                {selectedVehicle.baseline_efficiency_wh_km} Wh/km
              </Text>
            </View>

            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Estimated Full Range</Text>
              <Text style={styles.specVal}>
                {Math.round(
                  (selectedVehicle.battery_capacity_kwh * 1000) /
                    (selectedVehicle.baseline_efficiency_wh_km || 250)
                )}{" "}
                km
              </Text>
            </View>

            <View style={styles.specRow}>
              <Text style={styles.specLabel}>Operational Status</Text>
              <View style={styles.statusBadge}>
                <Text style={styles.statusBadgeText}>
                  {selectedVehicle.status || "ACTIVE"}
                </Text>
              </View>
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.emptyCard}>
          <MaterialCommunityIcons name="car-off" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No vehicles match the selected filter</Text>
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bgSurface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    color: colors.textPrimary,
    fontSize: 14,
  },
  filterRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterChipActive: {
    backgroundColor: colors.badgeBg,
    borderColor: colors.accentPrimary,
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
  },
  filterChipTextActive: {
    color: colors.accentPrimary,
    fontWeight: "700",
  },
  selectedWrapper: {
    marginTop: 8,
  },
  specCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 4,
  },
  specTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 12,
  },
  specRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  specLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  specVal: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  statusBadge: {
    backgroundColor: colors.badgeBg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  statusBadgeText: {
    color: colors.accentPrimary,
    fontSize: 11,
    fontWeight: "700",
  },
  emptyCard: {
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: 20,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 10,
  },
});
