import './App.css';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useFleetData } from './hooks/useFleetData';
import { Header } from './components/Header';
import { FleetPanel } from './components/FleetPanel';
import { ControlsBar } from './components/ControlsBar';
import { RouteInputs } from './components/RouteInputs';
import { SimulationResult } from './components/SimulationResult';
import { FleetComparison } from './components/FleetComparison';
import { formatReadingAge, isAssessmentOutdated, parseSimulationInputs } from '@fleet/api-client';
import type { DrivingStyle, HvacMode, RegenLevel, RoadType, SimulationNumericDraft, SimulationNumericParameters } from '@fleet/api-client';
import { MapPanel } from './components/MapPanel';
import { ElevationChart } from './components/ElevationChart';
import { ThermalMap } from './components/ThermalMap';
import { BatteryHealthChart } from './components/BatteryHealthChart';
import { RegenBrakingPanel } from './components/RegenBrakingPanel';
import { ChargingPanel } from './components/ChargingPanel';

// ── Static route data (Portland → Bend, GT-6 Corridor) ─────────────────
const TOTAL_DISTANCE = 129.4;

const ELEVATION_DATA = [
    { distance: 0,     elevation: 15 },
    { distance: 10,    elevation: 45 },
    { distance: 20,    elevation: 220 },
    { distance: 30,    elevation: 850 },
    { distance: 40,    elevation: 1260 },
    { distance: 50,    elevation: 1490 }, // Summit (Govt Camp)
    { distance: 60,    elevation: 1180 }, // Descent
    { distance: 70,    elevation: 720 },  // Plateau
    { distance: 80,    elevation: 480 },
    { distance: 90,    elevation: 320 },
    { distance: 100,   elevation: 260 },
    { distance: 110,   elevation: 210 },
    { distance: 120,   elevation: 190 },
    { distance: 129.4, elevation: 182 },
];

const DEMO_ELEVATION = ELEVATION_DATA.reduce((totals, point, index) => {
    if (index > 0) {
        const change = point.elevation - ELEVATION_DATA[index - 1].elevation;
        totals.gain += Math.max(0, change);
        totals.loss += Math.max(0, -change);
    }
    return totals;
}, { gain: 0, loss: 0 });

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
    let prevElevation = ELEVATION_DATA[0].elevation;
    let prevDistance = 0;

    return ELEVATION_DATA.map(({ distance, elevation }) => {
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
    // Extra heat near summit climb (progress ~ 0.35 to 0.45)
    const climbHeat = progressFraction > 0.25 && progressFraction < 0.48 ? 2.8 : 0;
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
    const { vehicles, telemetry, assessment, loading, error, simulationError, dataStatus, readingTime, lastFetchedAt, isSimulating, runSimulation, runBatchSimulation } = useFleetData();

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
    const [routeValues, setRouteValues] = useState<SimulationNumericDraft>({
        route_distance_km: String(TOTAL_DISTANCE),
        elevation_gain_m: String(DEMO_ELEVATION.gain),
        elevation_loss_m: String(DEMO_ELEVATION.loss),
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
                (e.target.matches('input, select, textarea, button') || e.target.isContentEditable)) return;
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
                routeDistance={TOTAL_DISTANCE}
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
                <div className="api-banner">
                    {dataStatus === 'live' ? 'Backend connected' : dataStatus === 'cached' ? 'Cached backend fleet' : 'Demo fleet'}
                    {lastFetchedAt && ` · Last fleet fetch: ${new Date(lastFetchedAt).toLocaleTimeString()}`}
                    {' · Battery reading ages shown per vehicle; connection status does not establish freshness.'}
                </div>

                {simulationError && (
                    <div className="api-banner api-banner--error" role="alert">
                        Simulation unavailable: {simulationError}
                    </div>
                )}

                <RouteInputs
                    values={routeValues}
                    roadType={roadType}
                    onValuesChange={setRouteValues}
                    onRoadTypeChange={setRoadType}
                    onSubmit={handleRunSimulation}
                />
                <ControlsBar
                    isRunning={isRunning}
                    onToggleRunning={() => setIsRunning(r => !r)}
                    speed={speed}
                    onSpeedChange={setSpeed}
                    onReset={() => setProgressFraction(0)}
                    drivingStyle={drivingStyle}
                    onDrivingStyleChange={setDrivingStyle}
                    hvacMode={hvacMode}
                    onHvacModeChange={setHvacMode}
                    regenLevel={regenLevel}
                    onRegenLevelChange={setRegenLevel}
                    progressFraction={progressFraction}
                    onProgressChange={setProgressFraction}
                    selectedVehicleId={selectedVehicleId}
                    isSimulating={isSimulating}
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
            </div>

            <div className="main-content">
                <FleetPanel
                    vehicles={vehicles}
                    selectedId={selectedVehicleId}
                    onSelect={setSelectedVehicleId}
                />

                <MapPanel
                    vehicles={vehicles}
                    selectedVehicleId={selectedVehicleId}
                    progressFraction={progressFraction}
                    onSelectVehicle={setSelectedVehicleId}
                    onSelectStation={setSelectedStationId}
                />

                <ElevationChart
                    elevationData={ELEVATION_DATA}
                    socData={socData}
                    totalDistance={TOTAL_DISTANCE}
                    progressFraction={progressFraction}
                />

                <ThermalMap
                    cellTemps={thermalGrid}
                    maxTemp={maxTemp}
                    avgTemp={avgTemp}
                    packHealthPct={activeVehicle.current_soh}
                    readingLabel={selectedTelemetry
                        ? `${dataStatus === 'demo' ? 'Demo' : 'Reported'} pack temperature: ${selectedTelemetry.pack_temp_c.toFixed(1)}°C · ${formatReadingAge(selectedTelemetry.timestamp, readingTime)}`
                        : 'Pack temperature unavailable · Illustrative baseline 31.5°C'}
                />
            </div>

            <div className="bottom-row">
                <BatteryHealthChart
                    vehicles={vehicles}
                    selectedVehicleId={selectedVehicleId}
                />
                <RegenBrakingPanel
                    vehicles={vehicles}
                    selectedVehicleId={selectedVehicleId}
                    regenLevel={regenLevel}
                />
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
