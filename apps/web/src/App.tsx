import './App.css';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useFleetData } from './hooks/useFleetData';
import { Header } from './components/Header';
import { FleetPanel } from './components/FleetPanel';
import { ControlsBar } from './components/ControlsBar';
import { RouteInputs } from './components/RouteInputs';
import type { RoutePreset } from './components/RouteInputs';
import { SimulationResult } from './components/SimulationResult';
import { FleetComparison } from './components/FleetComparison';
import { AssessmentHistory } from './components/AssessmentHistory';
import { formatReadingAge, isAssessmentOutdated, parseSimulationInputs } from '@fleet/api-client';
import type { DrivingStyle, HvacMode, RegenLevel, RoadType, SimulationNumericDraft, SimulationNumericParameters } from '@fleet/api-client';
import { MapPanel } from './components/MapPanel';
import { ElevationChart } from './components/ElevationChart';
import { ThermalMap } from './components/ThermalMap';
import { BatteryHealthChart } from './components/BatteryHealthChart';
import { RegenBrakingPanel } from './components/RegenBrakingPanel';
import { ChargingPanel } from './components/ChargingPanel';
import { ELEVATION_PROFILE, ROUTE_DISTANCE_KM, ROUTE_ELEVATION } from './routeData';

// Climb up to the route's highest point (past Government Camp)
const SUMMIT_FRACTION = ELEVATION_PROFILE.reduce((top, p) => (p.elevation > top.elevation ? p : top)).distance / ROUTE_DISTANCE_KM;

// Example trips that fill the route fields; only Portland → Bend matches the map.
const ROUTE_PRESETS: RoutePreset[] = [
    { label: 'Portland → Bend (mountain pass)', distanceKm: ROUTE_DISTANCE_KM, gainM: ROUTE_ELEVATION.gain, lossM: ROUTE_ELEVATION.loss, roadType: 'MIXED' },
    { label: 'City deliveries', distanceKm: 60, gainM: 120, lossM: 120, roadType: 'URBAN' },
    { label: 'Flat highway run', distanceKm: 200, gainM: 150, lossM: 150, roadType: 'HIGHWAY' },
];

// Helper to compute physics-informed SOC curve along the route
function buildDynamicSocData(
    startSoc: number,
    batteryCapacityKwh: number,
    baseEfficiencyWhKm: number,
    drivingStyle: DrivingStyle,
    hvacMode: HvacMode,
    regenLevel: RegenLevel,
    payloadKg: number
) {
    const styleMultiplier = drivingStyle === 'ECO' ? 0.88 : drivingStyle === 'AGGRESSIVE' ? 1.25 : 1.0;
    const hvacKw = hvacMode === 'OFF' ? 0 : hvacMode === 'LOW' ? 1.0 : hvacMode === 'MEDIUM' ? 2.2 : 3.8;
    const regenEfficiency = regenLevel === 'OFF' ? 0 : regenLevel === 'LOW' ? 0.12 : regenLevel === 'MEDIUM' ? 0.22 : 0.32;
    const payloadFactor = 1 + (payloadKg / 1000) * 0.15;

    let cumulativeKwhUsed = 0;
    let prevElevation = ELEVATION_PROFILE[0].elevation;
    let prevDistance = 0;

    return ELEVATION_PROFILE.map(({ distance, elevation }) => {
        const segDistanceKm = distance - prevDistance;
        const deltaElevM = elevation - prevElevation;

        if (segDistanceKm > 0) {
            // Flat rolling + aero energy
            const baseKwh = (segDistanceKm * baseEfficiencyWhKm * styleMultiplier * payloadFactor) / 1000;
            // Potential energy for climb (m * g * h) or regen recapture on descent
            const climbKwh = deltaElevM > 0
                ? ((1800 + payloadKg) * 9.81 * deltaElevM) / 3600000
                : (((1800 + payloadKg) * 9.81 * deltaElevM) / 3600000) * regenEfficiency;
            // HVAC energy (assuming avg speed 75 km/h)
            const travelHours = segDistanceKm / 75;
            const hvacKwh = hvacKw * travelHours;

            cumulativeKwhUsed += Math.max(0, baseKwh + climbKwh + hvacKwh);
        }

        prevDistance = distance;
        prevElevation = elevation;

        const currentCapacityKwh = (startSoc / 100) * batteryCapacityKwh;
        const remainingKwh = Math.max(0, currentCapacityKwh - cumulativeKwhUsed);
        const currentSocPct = Math.max(2, Math.min(100, (remainingKwh / batteryCapacityKwh) * 100));

        return { distance, soc: currentSocPct };
    });
}

function buildThermalGrid(baseTempC: number, drivingStyle: DrivingStyle, progressFraction: number): number[][] {
    const loadBonus = drivingStyle === 'AGGRESSIVE' ? 3.5 : drivingStyle === 'ECO' ? -1.0 : 0;
    // Extra heat on the climb up to the summit
    const climbHeat = progressFraction > 0 && progressFraction < SUMMIT_FRACTION ? 2.8 : 0;
    const effectiveBase = baseTempC + loadBonus + climbHeat;

    return Array.from({ length: 4 }, (_, r) =>
        Array.from({ length: 6 }, (_, c) => {
            const centerDist = Math.hypot(r - 1.5, c - 2.5);
            // Cells in the center of the battery pack run warmer due to thermal insulation
            const moduleOffset = (2.8 - centerDist) * 1.4;
            const variation = ((r * 6 + c) % 5) * 0.4 - 1.0;
            return Math.round((effectiveBase + moduleOffset + variation) * 10) / 10;
        })
    );
}

// ──────────────────────────────────────────────────────────────────────────
function App() {
    const { vehicles, telemetry, assessment, loading, error, simulationError, dataStatus, readingTime, lastFetchedAt, isSimulating, runSimulation, runBatchSimulation, getSimulationHistory } = useFleetData();

    const [requestedVehicleId, setSelectedVehicleId] = useState<string | null>('EV-001');
    const selectedVehicleId = vehicles.some(vehicle => vehicle.id === requestedVehicleId)
        ? requestedVehicleId : vehicles[0]?.id ?? null;
    const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

    // Playback and vehicle controls
    const [isRunning, setIsRunning] = useState(true);
    const [speed, setSpeed] = useState(2);
    const [progressFraction, setProgressFraction] = useState(0.48);
    const [drivingStyle, setDrivingStyle] = useState<DrivingStyle>('NORMAL');
    const [hvacMode, setHvacMode] = useState<HvacMode>('LOW');
    const [regenLevel, setRegenLevel] = useState<RegenLevel>('MEDIUM');
    // Per-browser view preference; storage may be blocked, so fall back to the simple view.
    const [showAdvanced, setShowAdvanced] = useState(() => {
        try { return localStorage.getItem('fleet.showAdvanced') === '1'; } catch { return false; }
    });
    const toggleAdvanced = () => setShowAdvanced(shown => {
        try { localStorage.setItem('fleet.showAdvanced', shown ? '0' : '1'); } catch { /* keep in-memory only */ }
        return !shown;
    });
    const [routeValues, setRouteValues] = useState<SimulationNumericDraft>({
        route_distance_km: String(ROUTE_DISTANCE_KM),
        elevation_gain_m: String(ROUTE_ELEVATION.gain),
        elevation_loss_m: String(ROUTE_ELEVATION.loss),
        ambient_temp_c: '22',
        payload_kg: '450',
        reserve_soc_target_pct: '15',
    });
    const [roadType, setRoadType] = useState<RoadType>('MIXED');
    const { parameters } = parseSimulationInputs(routeValues);
    const payload = Number.isFinite(Number(routeValues.payload_kg))
        ? Math.max(0, Number(routeValues.payload_kg)) : 0;
    const currentRequest = parameters && selectedVehicleId ? {
        ...parameters,
        vehicle_id: selectedVehicleId,
        road_type: roadType,
        driving_style: drivingStyle,
        hvac_mode: hvacMode,
        regen_level: regenLevel,
    } : null;

    const lastTimeRef = useRef<number>(performance.now());

    // ── Continuous Playback Loop ──────────────────────────────────────────
    useEffect(() => {
        let animFrameId: number;

        const loop = (now: number) => {
            const dt = (now - lastTimeRef.current) / 1000;
            lastTimeRef.current = now;

            if (isRunning) {
                setProgressFraction(prev => {
                    // Full route takes ~60s at 1x speed
                    const delta = (dt * speed) / 60;
                    const next = prev + delta;
                    return next >= 1 ? 0 : next;
                });
            }

            animFrameId = requestAnimationFrame(loop);
        };

        lastTimeRef.current = performance.now();
        animFrameId = requestAnimationFrame(loop);

        return () => cancelAnimationFrame(animFrameId);
    }, [isRunning, speed]);

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLElement &&
                (e.target.matches('input, select, textarea, button, [role="button"]') || e.target.isContentEditable ||
                    e.target.closest('.leaflet-container'))) return; // the focused map owns arrows/+/- for panning and zoom
            if (e.code === 'Space') {
                e.preventDefault();
                setIsRunning(r => !r);
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                setProgressFraction(p => Math.max(0, p - 0.05));
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                setProgressFraction(p => Math.min(1, p + 0.05));
            } else if (e.key >= '1' && e.key <= '6') {
                const idx = parseInt(e.key, 10) - 1;
                if (vehicles[idx]) setSelectedVehicleId(vehicles[idx].id);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [vehicles]);

    const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId) ?? vehicles[0];
    const activeVehicle = selectedVehicle ?? {
        id: 'EV-001',
        name: 'Alpha',
        model: 'Tesla Model 3',
        battery_capacity_kwh: 75,
        baseline_efficiency_wh_km: 160,
        current_soc: 82.4,
        current_soh: 96.1,
        status: 'IN_USE',
        state_source: 'vehicle_defaults' as const,
        state_timestamp: null,
    };
    const selectedTelemetry = selectedVehicleId ? telemetry[selectedVehicleId] : null;
    const assessmentOutdated = assessment ? isAssessmentOutdated(assessment, currentRequest, selectedVehicle) : false;

    // Dynamically calculate State of Charge curve for the selected vehicle
    const socData = useMemo(() => {
        return buildDynamicSocData(
            activeVehicle.current_soc,
            activeVehicle.battery_capacity_kwh,
            activeVehicle.baseline_efficiency_wh_km,
            drivingStyle,
            hvacMode,
            regenLevel,
            payload
        );
    }, [activeVehicle, drivingStyle, hvacMode, regenLevel, payload]);

    // Compute pack thermal distribution
    const thermalGrid = useMemo(() => {
        return buildThermalGrid(selectedTelemetry?.pack_temp_c ?? 31.5, drivingStyle, progressFraction);
    }, [selectedTelemetry?.pack_temp_c, drivingStyle, progressFraction]);

    const allTemps = thermalGrid.flat();
    const maxTemp = Math.max(...allTemps);
    const avgTemp = allTemps.reduce((s, t) => s + t, 0) / allTemps.length;
    const avgSoh = vehicles.length > 0
        ? vehicles.reduce((s, v) => s + v.current_soh, 0) / vehicles.length
        : 0;

    // ── Delegate simulation to backend via the hook ────────────────────
    const handleRunSimulation = (parameters: SimulationNumericParameters & { road_type: RoadType }) => {
        if (!selectedVehicleId || isSimulating) return;
        runSimulation({
            ...parameters,
            vehicle_id: selectedVehicleId,
            driving_style: drivingStyle,
            hvac_mode: hvacMode,
            regen_level: regenLevel,
        });
    };

    if (!loading && vehicles.length === 0) {
        return (
            <div className="dashboard">
                {error && <div className="api-banner api-banner--error">Connection lost — showing cached fleet data. ({error})</div>}
                <div className="api-banner">No vehicles registered.</div>
            </div>
        );
    }

    return (
        <div className="dashboard">
            <Header
                fleetCount={vehicles.length}
                routeDistance={ROUTE_DISTANCE_KM}
                batteryHealth={Math.round(avgSoh * 10) / 10}
            />

            <div className="assessment-toolbar">
                {/* ── Backend status banners ────────────────────────────────── */}
                {loading && (
                    <div className="api-banner api-banner--loading">
                        Connecting to fleet backend — showing demo data…
                    </div>
                )}
                {!loading && error && (
                    <div className="api-banner api-banner--error">
                        {dataStatus === 'demo' ? 'Offline demo data' : 'Connection lost — showing cached fleet data'}. ({error})
                    </div>
                )}
                <p className={`data-status data-status--${dataStatus}`}>
                    <span className="data-status-dot" aria-hidden="true" />
                    {dataStatus === 'live' ? 'Live fleet data' : dataStatus === 'cached' ? 'Saved fleet data' : 'Demo fleet data'}
                    {lastFetchedAt && ` · updated ${new Date(lastFetchedAt).toLocaleTimeString()}`}
                </p>

                {simulationError && (
                    <div className="api-banner api-banner--error" role="alert">
                        Simulation unavailable: {simulationError}
                    </div>
                )}

                <RouteInputs
                    vehicles={vehicles}
                    selectedVehicleId={selectedVehicleId}
                    onVehicleChange={setSelectedVehicleId}
                    values={routeValues}
                    roadType={roadType}
                    presets={ROUTE_PRESETS}
                    onValuesChange={setRouteValues}
                    onRoadTypeChange={setRoadType}
                    drivingStyle={drivingStyle}
                    onDrivingStyleChange={setDrivingStyle}
                    hvacMode={hvacMode}
                    onHvacModeChange={setHvacMode}
                    regenLevel={regenLevel}
                    onRegenLevelChange={setRegenLevel}
                    isSimulating={isSimulating}
                    onSubmit={handleRunSimulation}
                />
                {assessment && (
                    <SimulationResult
                        assessment={assessment}
                        isOutdated={assessmentOutdated}
                    >
                        <FleetComparison
                            assessment={assessment}
                            currentRequest={currentRequest}
                            vehicles={vehicles}
                            isOutdated={assessmentOutdated}
                            isConnected={dataStatus === 'live'}
                            readingTime={readingTime}
                            runComparison={runBatchSimulation}
                            onSelectAndAssess={vehicleId => {
                                if (isSimulating || !currentRequest) return;
                                setSelectedVehicleId(vehicleId);
                                void runSimulation({ ...currentRequest, vehicle_id: vehicleId });
                            }}
                        />
                    </SimulationResult>
                )}
                {selectedVehicleId && (
                    <AssessmentHistory
                        vehicleId={selectedVehicleId}
                        refreshKey={assessment}
                        loadHistory={getSimulationHistory}
                    />
                )}
                <ControlsBar
                    isRunning={isRunning}
                    onToggleRunning={() => setIsRunning(r => !r)}
                    speed={speed}
                    onSpeedChange={setSpeed}
                    onReset={() => setProgressFraction(0)}
                    progressFraction={progressFraction}
                    onProgressChange={setProgressFraction}
                    routeDistanceKm={ROUTE_DISTANCE_KM}
                    showAdvanced={showAdvanced}
                    onToggleAdvanced={toggleAdvanced}
                />
            </div>

            <div className={`main-content ${showAdvanced ? '' : 'main-content--simple'}`}>
                <FleetPanel
                    vehicles={vehicles}
                    selectedId={selectedVehicleId}
                    onSelect={setSelectedVehicleId}
                />

                <MapPanel
                    vehicles={vehicles}
                    telemetry={telemetry}
                    dataStatus={dataStatus}
                    selectedVehicleId={selectedVehicleId}
                    selectedStationId={selectedStationId}
                    progressFraction={progressFraction}
                    onSelectVehicle={setSelectedVehicleId}
                    onSelectStation={setSelectedStationId}
                    onProgressChange={setProgressFraction}
                />

                <ElevationChart
                    elevationData={ELEVATION_PROFILE}
                    socData={socData}
                    totalDistance={ROUTE_DISTANCE_KM}
                    progressFraction={progressFraction}
                />

                {showAdvanced && (
                    <ThermalMap
                        cellTemps={thermalGrid}
                        maxTemp={maxTemp}
                        avgTemp={avgTemp}
                        packHealthPct={activeVehicle.current_soh}
                        readingLabel={selectedTelemetry
                            ? `${dataStatus === 'demo' ? 'Demo' : 'Reported'} pack temperature: ${selectedTelemetry.pack_temp_c.toFixed(1)}°C · ${formatReadingAge(selectedTelemetry.timestamp, readingTime)}`
                            : 'Pack temperature unavailable · Illustrative baseline 31.5°C'}
                    />
                )}
            </div>

            <div className={`bottom-row ${showAdvanced ? '' : 'bottom-row--simple'}`}>
                {showAdvanced && (
                    <>
                        <BatteryHealthChart
                            vehicles={vehicles}
                            selectedVehicleId={selectedVehicleId}
                        />
                        <RegenBrakingPanel
                            vehicles={vehicles}
                            selectedVehicleId={selectedVehicleId}
                            regenLevel={regenLevel}
                        />
                    </>
                )}
                <ChargingPanel
                    vehicles={vehicles}
                    selectedVehicleId={selectedVehicleId}
                    selectedStationId={selectedStationId}
                    onSelectStation={setSelectedStationId}
                />
            </div>
        </div>
    );
}

export default App;
