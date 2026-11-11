import React, { useCallback, useEffect, useRef, useState } from "react";
import { StatusBar } from "expo-status-bar";
import { AppState, StyleSheet, Text, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { FleetApiError, getSimulationVehicleProfile } from "@fleet/api-client";
import type { SimulationAssessment, SimulationRequest, SimulationResponse, TelemetryEvent, Vehicle, VehicleCreate, VehicleUpdate } from "@fleet/api-client";

import { client } from "./src/config/api";
import { colors } from "./src/constants/theme";
import { BottomNavBar, type TabType } from "./src/navigation";
import {
  DashboardScreen,
  FleetScreen,
  SimulatorScreen,
  AlertsScreen,
  MoreScreen,
  BatteryScreen,
  RouteScreen,
  GarageScreen,
} from "./src/screens";

const fallbackVehicles: Vehicle[] = [
  {
    id: "DL641",
    name: "VANZ",
    model: "Ford E-Transit (High Roof)",
    battery_capacity_kwh: 74,
    baseline_efficiency_wh_km: 175,
    current_soc: 80,
    current_soh: 100,
    status: "ACTIVE",
    state_source: "vehicle_defaults",
    state_timestamp: null,
  },
  {
    id: "DL642",
    name: "ISUKA",
    model: "Rivian Commercial EDV",
    battery_capacity_kwh: 65,
    baseline_efficiency_wh_km: 185,
    current_soc: 72,
    current_soh: 100,
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
  const [currentTab, setCurrentTab] = useState<TabType>("dashboard");
  const [vehicles, setVehicles] = useState<Vehicle[]>(fallbackVehicles);
  const [telemetry, setTelemetry] = useState<Record<string, TelemetryEvent>>({});
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(fallbackVehicles[0]);
  const [assessment, setAssessment] = useState<SimulationAssessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<"demo" | "live" | "cached">("demo");
  const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
  // Advance reading ages even when a failed fetch leaves the cached values unchanged.
  const [, refreshReadingAges] = useState(Date.now);
  const hasBackendData = useRef(false);
  const fetchingVehicles = useRef(false);

  const loadVehicles = useCallback(async (showLoading = true) => {
    if (fetchingVehicles.current) return;
    fetchingVehicles.current = true;
    if (showLoading) setLoading(true);
    try {
      const [data, fleetTelemetry] = await Promise.all([
        client.getVehicles(),
        client.getFleetLatestTelemetry(),
      ]);
      const vehicleIds = new Set(data.map(vehicle => vehicle.id));
      setVehicles(data);
      setTelemetry(Object.fromEntries(
        Object.entries(fleetTelemetry.data).filter(([id]) => vehicleIds.has(id))
      ));
      setSelectedVehicle(previous => data.find(vehicle => vehicle.id === previous?.id) ?? data[0] ?? null);
      hasBackendData.current = true;
      setLastFetchedAt(new Date().toISOString());
      setDataStatus("live");
      setFleetError(null);
    } catch (err) {
      setFleetError(err instanceof Error ? err.message : "Failed to load fleet");
      setDataStatus(hasBackendData.current ? "cached" : "demo");
    } finally {
      fetchingVehicles.current = false;
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = AppState.currentState !== "background" && AppState.currentState !== "inactive";
    const refresh = () => {
      if (!active) return;
      refreshReadingAges(Date.now());
      void loadVehicles(false);
    };
    if (active) void loadVehicles();
    const interval = setInterval(refresh, 5000);
    const subscription = AppState.addEventListener("change", state => {
      active = state === "active";
      if (active) refresh();
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [loadVehicles]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadVehicles();
    setRefreshing(false);
  };

  async function handleRunSimulation(params: Required<SimulationRequest>): Promise<SimulationResponse | null> {
    const request = { ...params };
    setLoading(true);
    setError(null);
    setAssessment(null);
    try {
      const result = await client.runSimulation(request);
      setAssessment({ request, response: result, origin: "backend" });
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
      const hvacKw = { OFF: 0, LOW: 1.5, MEDIUM: 2.2, HIGH: 3.5 }[params.hvac_mode ?? "LOW"];
      const drivingMult = params.driving_style === "AGGRESSIVE" ? 1.25 : params.driving_style === "ECO" ? 0.88 : 1.0;
      
      const estimatedConsumptionKwh =
        params.route_distance_km * baseKwhPerKm * payloadPenalty * drivingMult +
        elevationWorkKwh +
        hvacKw * (params.route_distance_km / 65);
      
      const socConsumedPct = (estimatedConsumptionKwh / vehicle.battery_capacity_kwh) * 100;
      // Preserve energy deficits so zero reserve cannot make an infeasible route acceptable.
      const projectedArrivalSoc = startSoc - socConsumedPct;
      const remainingRange = (Math.max(0, projectedArrivalSoc) / 100) * ((vehicle.battery_capacity_kwh * 1000) / (vehicle.baseline_efficiency_wh_km || 280));
      
      const riskLevel: "SAFE" | "CAUTION" | "NOT_RECOMMENDED" =
        projectedArrivalSoc < targetReservePct
          ? "NOT_RECOMMENDED"
          : projectedArrivalSoc < targetReservePct + 10
          ? "CAUTION"
          : "SAFE";

      const mockResponse: SimulationResponse = {
        vehicle_id: vehicle.id,
        vehicle_profile: getSimulationVehicleProfile(vehicle),
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
            : riskLevel === "CAUTION"
            ? "Arrival margin is limited. Charge before departure or reduce demand and assess again."
            : "Energy margin is sufficient. Maintain Eco/Normal mode on highway sections.",
        ],
      };

      setAssessment({ request, response: mockResponse, origin: "local" });
      return mockResponse;
    } finally {
      setLoading(false);
    }
  }

  const handleSimulateWithVehicle = (vehicle: Vehicle) => {
    setSelectedVehicle(vehicle);
    setCurrentTab("simulator");
  };

  const handleUpdateVehicle = async (vehicleId: string, payload: VehicleUpdate): Promise<Vehicle> => {
    const updated = await client.updateVehicle(vehicleId, payload);
    setVehicles(current => current.map(v => (v.id === vehicleId ? updated : v)));
    setSelectedVehicle(prev => (prev?.id === vehicleId ? updated : prev));
    void loadVehicles(false);
    return updated;
  };

  const handleDeleteVehicle = async (vehicleId: string): Promise<void> => {
    await client.deleteVehicle(vehicleId);
    setVehicles(current => current.filter(v => v.id !== vehicleId));
    setTelemetry(({ [vehicleId]: _removed, ...rest }) => rest);
    setSelectedVehicle(prev => (prev?.id === vehicleId ? null : prev));
    void loadVehicles(false);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar style="light" />

        <Text style={styles.dataBanner} accessibilityRole="text">
          {dataStatus === "live" ? "Backend connected" : dataStatus === "demo" ? "Demo fleet data" : "Connection lost — showing cached fleet data"}
          {lastFetchedAt ? ` · Last fleet fetch: ${new Date(lastFetchedAt).toLocaleTimeString()}` : ""}
          {" · Battery reading ages shown per vehicle."}
          {fleetError ? ` · ${fleetError}` : ""}
        </Text>
        {/* Screen Container */}
        <View style={styles.content}>
          {currentTab === "battery" && (
            <BatteryScreen
              vehicles={vehicles}
              selectedVehicle={selectedVehicle}
              onSelectVehicle={setSelectedVehicle}
              onNavigateTab={setCurrentTab}
            />
          )}

          {currentTab === "dashboard" && (
            <DashboardScreen
              vehicles={vehicles}
              onNavigateTab={setCurrentTab}
              onSelectVehicle={setSelectedVehicle}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          )}

          {currentTab === "garage" && (
            <GarageScreen
              vehicles={vehicles}
              selectedVehicle={selectedVehicle}
              dataStatus={dataStatus}
              onSelectVehicle={setSelectedVehicle}
              onCreate={dataStatus === "live" ? async (payload: VehicleCreate) => {
                const created = await client.createVehicle(payload);
                setVehicles(current => [...current, created]);
                setSelectedVehicle(created);
                return created;
              } : undefined}
            />
          )}

          {(currentTab === "fleet" || currentTab === "vehicles") && (
            <FleetScreen
              vehicles={vehicles}
              selectedVehicle={selectedVehicle}
              loading={loading}
              error={fleetError}
              dataStatus={dataStatus}
              onSelectVehicle={setSelectedVehicle}
              onRefresh={handleRefresh}
              onSimulateWithVehicle={handleSimulateWithVehicle}
              refreshing={refreshing}
              onNavigateTab={setCurrentTab}
              onUpdateVehicle={dataStatus === "live" ? handleUpdateVehicle : undefined}
              onDeleteVehicle={dataStatus === "live" ? handleDeleteVehicle : undefined}
            />
          )}

          {currentTab === "route" && (
            <RouteScreen
              vehicles={vehicles}
              telemetry={telemetry}
              dataStatus={dataStatus}
              selectedVehicle={selectedVehicle}
              onSelectVehicle={setSelectedVehicle}
              onNavigateTab={setCurrentTab}
            />
          )}

          {(currentTab === "simulator" || currentTab === "planner") && (
            <SimulatorScreen
              vehicles={vehicles}
              selectedVehicle={selectedVehicle}
              onSelectVehicle={setSelectedVehicle}
              onRunSimulation={handleRunSimulation}
              assessment={assessment}
              loading={loading}
              error={error}
              dataStatus={dataStatus}
              onNavigateTab={setCurrentTab}
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
          alertCount={0}
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
