import React from "react";
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import type { Vehicle } from "@fleet/api-client";
import { colors } from "../constants/theme";
import { Header } from "../components";
import type { TabType } from "../navigation";

interface DashboardScreenProps {
  vehicles: Vehicle[];
  onNavigateTab: (tab: TabType) => void;
  onSelectVehicle: (vehicle: Vehicle) => void;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  vehicles,
  onNavigateTab,
  onSelectVehicle,
  refreshing = false,
  onRefresh,
}) => {
  const totalVehicles = vehicles.length || 3;
  const activeVehicles = vehicles.filter((v) => v.status === "ACTIVE").length || 2;
  const avgSoc = vehicles.length
    ? Math.round(
        vehicles.reduce((acc, v) => acc + (v.current_soc || 0), 0) / vehicles.length
      )
    : 78;

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
        title="Live Tracking"
        subtitle="Real-Time Operation & Route Decision Support"
      />

      {/* KPI Stats Grid */}
      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Total Fleet</Text>
            <MaterialCommunityIcons name="car-multiple" size={18} color={colors.accentPrimary} />
          </View>
          <Text style={styles.statValue}>{totalVehicles}</Text>
          <Text style={styles.statSub}>{activeVehicles} active on route</Text>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Average SOC</Text>
            <MaterialCommunityIcons name="battery-charging-high" size={18} color="#2ECC71" />
          </View>
          <Text style={styles.statValue}>{avgSoc}%</Text>
          <Text style={styles.statSub}>Good reserve status</Text>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Energy Consumed</Text>
            <MaterialCommunityIcons name="lightning-bolt" size={18} color="#F1C40F" />
          </View>
          <Text style={styles.statValue}>142 kWh</Text>
          <Text style={styles.statSub}>Today's telemetry</Text>
        </View>

        <View style={styles.statCard}>
          <View style={styles.statHeader}>
            <Text style={styles.statLabel}>Active Warnings</Text>
            <MaterialCommunityIcons name="alert-circle" size={18} color="#E74C3C" />
          </View>
          <Text style={styles.statValue}>2</Text>
          <Text style={styles.statSub}>1 Low SOC warning</Text>
        </View>
      </View>

      {/* Quick Action Simulator Banner */}
      <TouchableOpacity
        style={styles.actionBanner}
        onPress={() => onNavigateTab("simulator")}
        activeOpacity={0.8}
      >
        <View style={styles.actionBannerLeft}>
          <View style={styles.bannerIconWrapper}>
            <MaterialCommunityIcons name="leaf-circle" size={28} color="#2ECC71" />
          </View>
          <View style={styles.actionBannerText}>
            <Text style={styles.bannerTitle}>Physics Energy Simulator</Text>
            <Text style={styles.bannerSubtitle}>
              Predict arrival SOC with aero drag, payload & elevation
            </Text>
          </View>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={24} color={colors.textMuted} />
      </TouchableOpacity>

      {/* Fleet Live Telemetry Snapshot */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Live Telematics Feed</Text>
        <TouchableOpacity onPress={() => onNavigateTab("fleet")}>
          <Text style={styles.sectionLink}>View All ({totalVehicles})</Text>
        </TouchableOpacity>
      </View>

      {(vehicles.length > 0 ? vehicles : mockVehicles).map((vehicle) => {
        const isLow = (vehicle.current_soc ?? 80) < 20;
        return (
          <TouchableOpacity
            key={vehicle.id}
            style={styles.vehicleRow}
            onPress={() => {
              onSelectVehicle(vehicle);
              onNavigateTab("fleet");
            }}
            activeOpacity={0.7}
          >
            <View style={styles.vehicleRowLeft}>
              <View style={[styles.vehicleIconBadge, isLow && styles.vehicleIconBadgeLow]}>
                <MaterialCommunityIcons
                  name="car-electric"
                  size={22}
                  color={isLow ? "#E74C3C" : "#2ECC71"}
                />
              </View>
              <View>
                <Text style={styles.vehicleRowName}>{vehicle.name}</Text>
                <Text style={styles.vehicleRowModel}>
                  {vehicle.model} • {vehicle.battery_capacity_kwh} kWh
                </Text>
              </View>
            </View>

            <View style={styles.vehicleRowRight}>
              <View
                style={[
                  styles.socBadge,
                  isLow ? styles.socBadgeLow : styles.socBadgeNormal,
                ]}
              >
                <Text
                  style={[
                    styles.socText,
                    isLow ? styles.socTextLow : styles.socTextNormal,
                  ]}
                >
                  {vehicle.current_soc ?? 85}% SOC
                </Text>
              </View>
              <Text style={styles.vehicleStatus}>{vehicle.status || "IDLE"}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const mockVehicles: Vehicle[] = [
  {
    id: "v1",
    name: "Delivery Van A",
    model: "Ford E-Transit",
    battery_capacity_kwh: 68,
    baseline_efficiency_wh_km: 260,
    current_soc: 82,
    current_soh: 98,
    status: "ACTIVE",
  },
  {
    id: "v2",
    name: "Freight Runner B",
    model: "Rivian EDV 700",
    battery_capacity_kwh: 135,
    baseline_efficiency_wh_km: 380,
    current_soc: 18,
    current_soh: 96,
    status: "ACTIVE",
  },
  {
    id: "v3",
    name: "Urban Cargo C",
    model: "Mercedes eSprinter",
    battery_capacity_kwh: 113,
    baseline_efficiency_wh_km: 310,
    current_soc: 94,
    current_soh: 99,
    status: "IDLE",
  },
];

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
  },
  statCard: {
    flexBasis: "48%",
    flexGrow: 1,
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    fontWeight: "500",
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
  actionBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bgSurfaceAlt,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.accentPrimarySubtle,
    marginBottom: 24,
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
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.bgSurface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
  },
  vehicleRowLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  vehicleIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: colors.bgSurfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  vehicleIconBadgeLow: {
    backgroundColor: colors.riskDangerBg,
  },
  vehicleRowName: {
    fontSize: 15,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 2,
  },
  vehicleRowModel: {
    fontSize: 12,
    color: colors.textMuted,
  },
  vehicleRowRight: {
    alignItems: "flex-end",
  },
  socBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 4,
  },
  socBadgeNormal: {
    backgroundColor: colors.badgeBg,
  },
  socBadgeLow: {
    backgroundColor: colors.riskDangerBg,
  },
  socText: {
    fontSize: 12,
    fontWeight: "700",
  },
  socTextNormal: {
    color: colors.accentPrimary,
  },
  socTextLow: {
    color: colors.riskDanger,
  },
  vehicleStatus: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "500",
  },
});
