import React, { useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { FleetApiError } from "@fleet/api-client";
import type { SimulationRequest, SimulationResponse, Vehicle } from "@fleet/api-client";

import { client, API_URL } from "./src/config/api";
import { colors } from "./src/constants/theme";
import { BottomNavBar, type TabType } from "./src/navigation";
import {
  DashboardScreen,
  FleetScreen,
  SimulatorScreen,
  AlertsScreen,
  MoreScreen,
} from "./src/screens";

const fallbackVehicles: Vehicle[] = [
  {
    id: "v-transit-01",
    name: "Transit Van Alpha",
    model: "Ford E-Transit (High Roof)",
    battery_capacity_kwh: 68,
    baseline_efficiency_wh_km: 260,
    current_soc: 82,
    current_soh: 98,
    status: "ACTIVE",
    state_source: "vehicle_defaults",
    state_timestamp: null,
  },
  {
    id: "v-edv-02",
    name: "Rivian Prime 700",
    model: "Rivian Commercial EDV",
    battery_capacity_kwh: 135,
    baseline_efficiency_wh_km: 380,
    current_soc: 44,
    current_soh: 96,
    status: "ACTIVE",
    state_source: "vehicle_defaults",
    state_timestamp: null,
  },
  {
    id: "v-sprinter-03",
    name: "Urban Sprinter Gamma",
    model: "Mercedes eSprinter Cargo",
    battery_capacity_kwh: 113,
    baseline_efficiency_wh_km: 310,
    current_soc: 18,
    current_soh: 99,
    status: "IDLE",
    state_source: "vehicle_defaults",
    state_timestamp: null,
  },
];

export default function App() {
  const [currentTab, setCurrentTab] = useState<TabType>("simulator");
  const [vehicles, setVehicles] = useState<Vehicle[]>(fallbackVehicles);
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(fallbackVehicles[0]);
  const [simResult, setSimResult] = useState<SimulationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<"demo" | "live" | "cached">("demo");
  const [simulationOrigin, setSimulationOrigin] = useState<"backend" | "local">("backend");
  const hasBackendData = useRef(false);
  const fetchingVehicles = useRef(false);

  useEffect(() => {
    loadVehicles();
  }, []);

  async function loadVehicles() {
    if (fetchingVehicles.current) return;
    fetchingVehicles.current = true;
    setLoading(true);
    setFleetError(null);
    try {
      const data = await client.getVehicles();
      setVehicles(data);
      setSelectedVehicle(previous => data.find(vehicle => vehicle.id === previous?.id) ?? data[0] ?? null);
      hasBackendData.current = true;
      setDataStatus("live");
    } catch (err) {
      setFleetError(err instanceof Error ? err.message : "Failed to load fleet");
      setDataStatus(hasBackendData.current ? "cached" : "demo");
    } finally {
      fetchingVehicles.current = false;
      setLoading(false);
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadVehicles();
    setRefreshing(false);
  };

  async function handleRunSimulation(params: SimulationRequest): Promise<SimulationResponse | null> {
    setLoading(true);
    setError(null);
    setSimResult(null);
    try {
      const result = await client.runSimulation(params);
      setSimulationOrigin("backend");
      setSimResult(result);
      return result;
    } catch (err) {
      if (err instanceof FleetApiError) {
        setError(err.message);
        return null;
      }
      setFleetError(err instanceof Error ? err.message : "Failed to connect to fleet backend");
      setDataStatus(hasBackendData.current ? "cached" : "demo");
      setError("Backend simulation unavailable; showing an offline demo estimate.");
      // Realistic physics approximation fallback if offline
      const vehicle = vehicles.find((v) => v.id === params.vehicle_id) || selectedVehicle || fallbackVehicles[0];
      if (vehicle.battery_capacity_kwh <= 0 || vehicle.current_soh <= 0) {
        setError("Vehicle has no usable battery capacity; route assessment is unavailable");
        return null;
      }
      const startSoc = vehicle.current_soc ?? 80;
      const baseKwhPerKm = (vehicle.baseline_efficiency_wh_km || 280) / 1000;
      
      const payloadKg = params.payload_kg ?? 250;
      const elevationGainM = params.elevation_gain_m ?? 350;
      const targetReservePct = params.reserve_soc_target_pct ?? 15;

      const payloadPenalty = 1 + (payloadKg / 2000) * 0.15;
      const elevationWorkKwh = (elevationGainM * 2500 * 9.81) / (3.6e6 * 0.85);
      const hvacKw = params.hvac_mode === "HIGH" ? 3.5 : params.hvac_mode === "LOW" ? 1.5 : 0;
      const drivingMult = params.driving_style === "AGGRESSIVE" ? 1.25 : params.driving_style === "ECO" ? 0.88 : 1.0;
      
      const estimatedConsumptionKwh =
        params.route_distance_km * baseKwhPerKm * payloadPenalty * drivingMult +
        elevationWorkKwh +
        hvacKw * (params.route_distance_km / 65);
      
      const socConsumedPct = (estimatedConsumptionKwh / vehicle.battery_capacity_kwh) * 100;
      const projectedArrivalSoc = Math.max(0, startSoc - socConsumedPct);
      const remainingRange = (projectedArrivalSoc / 100) * ((vehicle.battery_capacity_kwh * 1000) / (vehicle.baseline_efficiency_wh_km || 280));
      
      const riskLevel: "SAFE" | "CAUTION" | "NOT_RECOMMENDED" =
        projectedArrivalSoc < targetReservePct
          ? "NOT_RECOMMENDED"
          : projectedArrivalSoc < targetReservePct + 10
          ? "CAUTION"
          : "SAFE";

      const mockResponse: SimulationResponse = {
        vehicle_id: vehicle.id,
        starting_soc_pct: vehicle.current_soc,
        starting_soh_pct: vehicle.current_soh,
        state_source: vehicle.state_source,
        state_timestamp: vehicle.state_timestamp,
        usable_battery_capacity_kwh: vehicle.battery_capacity_kwh * 0.95,
        projected_arrival_soc_pct: Number(projectedArrivalSoc.toFixed(1)),
        estimated_energy_consumption_kwh: Number(estimatedConsumptionKwh.toFixed(1)),
        remaining_range_km: Number(remainingRange.toFixed(1)),
        risk_level: riskLevel,
        confidence_score_pct: 94,
        recommendations: [
          riskLevel === "NOT_RECOMMENDED"
            ? "Route exceeds safe battery threshold. Consider intermediate fast charging or reduced HVAC."
            : "Energy margin is sufficient. Maintain Eco/Normal mode on highway sections.",
        ],
      };

      setSimulationOrigin("local");
      setSimResult(mockResponse);
      return mockResponse;
    } finally {
      setLoading(false);
    }
  }

  const handleSimulateWithVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setCurrentTab("simulator");
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar style="light" />

        {dataStatus !== "live" && (
          <Text style={styles.dataBanner} accessibilityRole="text">
            {dataStatus === "demo" ? "Offline demo fleet data" : "Connection lost — showing cached fleet data"}
            {fleetError ? ` · ${fleetError}` : ""}
          </Text>
        )}
        {/* Screen Container */}
        <View style={styles.content}>
          {currentTab === "dashboard" && (
            <DashboardScreen
              vehicles={vehicles}
              onNavigateTab={setCurrentTab}
              onSelectVehicle={setSelectedVehicle}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          )}

          {currentTab === "fleet" && (
            <FleetScreen
              vehicles={vehicles}
              selectedVehicle={selectedVehicle}
              loading={loading}
              error={fleetError}
              onSelectVehicle={setSelectedVehicle}
              onRefresh={handleRefresh}
              onSimulateWithVehicle={handleSimulateWithVehicle}
              refreshing={refreshing}
            />
          )}

          {currentTab === "simulator" && (
            <SimulatorScreen
              vehicles={vehicles}
              selectedVehicle={selectedVehicle}
              onSelectVehicle={setSelectedVehicle}
              onRunSimulation={handleRunSimulation}
              simResult={simResult}
              simulationOrigin={simulationOrigin}
              loading={loading}
              error={error}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          )}

          {currentTab === "alerts" && (
            <AlertsScreen
              onNavigateTab={setCurrentTab}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          )}

          {currentTab === "more" && (
            <MoreScreen
              onRefreshBackend={handleRefresh}
              refreshing={refreshing}
            />
          )}
        </View>

        {/* Bottom Navigation Bar */}
        <BottomNavBar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          alertCount={2}
        />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgBase,
  },
  dataBanner: {
    color: colors.riskCautionText,
    backgroundColor: colors.riskCautionBg,
    padding: 10,
    fontSize: 12,
  },
  content: {
    flex: 1,
  },
});
