import './App.css';
import './planner.css';
import { lazy, Suspense, useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useFleetData } from './hooks/useFleetData';
import { Sidebar, PAGES } from './components/Sidebar';
import type { PageId } from './components/Sidebar';
import { FleetOnboarding, FleetSummary, StatusBreakdown } from './components/FleetSummary';
import { FleetPanel } from './components/FleetPanel';
import { VehicleActions, VehicleForm } from './components/VehicleForm';
import { ControlsBar } from './components/ControlsBar';
import { RouteInputs } from './components/RouteInputs';
import type { RoutePreset } from './components/RouteInputs';
import { SimulationResult } from './components/SimulationResult';
import { FleetComparison } from './components/FleetComparison';
import { ScenarioComparison } from './components/ScenarioComparison';
import { DegradationOutlook } from './components/DegradationOutlook';
import { AssessmentHistory } from './components/AssessmentHistory';
import { AssessmentDetail } from './components/AssessmentDetail';
import { formatReadingAge, isAssessmentOutdated, parseSimulationInputs } from '@fleet/api-client';
import type { DrivingStyle, HvacMode, RegenLevel, RoadType, SimulationAssessment, SimulationNumericDraft, SimulationNumericParameters, SimulationRecord, SimulationRequest } from '@fleet/api-client';
import { MapPanel } from './components/MapPanel';
import { ElevationChart, interpolateAtDistance } from './components/ElevationChart';
import { ThermalMap } from './components/ThermalMap';
import { BatteryHealthChart } from './components/BatteryHealthChart';
import { RegenBrakingPanel } from './components/RegenBrakingPanel';
import { ChargingPanel } from './components/ChargingPanel';
import { ELEVATION_PROFILE, ROUTE_DISTANCE_KM, ROUTE_ELEVATION } from './routeData';
import { GaragePlaceholder } from './components/garage/GarageLoading';

// three.js is large; load the garage only when someone opens it.
const GaragePage = lazy(() => import('./components/garage/GaragePage').then(m => ({ default: m.GaragePage })));

// Climb up to the route's highest point (Baguio, at the top of Marcos Highway)
const SUMMIT_FRACTION = ELEVATION_PROFILE.reduce((top, p) => (p.elevation > top.elevation ? p : top)).distance / ROUTE_DISTANCE_KM;

// Example trips that fill the route fields; only Manila → Baguio matches the map.
const ROUTE_PRESETS: RoutePreset[] = [
    { label: 'Manila → Baguio (Marcos Highway)', distanceKm: ROUTE_DISTANCE_KM, gainM: ROUTE_ELEVATION.gain, lossM: ROUTE_ELEVATION.loss, roadType: 'MIXED' },
    { label: 'City deliveries', distanceKm: 60, gainM: 120, lossM: 120, roadType: 'URBAN' },
    { label: 'Flat highway run', distanceKm: 200, gainM: 150, lossM: 150, roadType: 'HIGHWAY' },
];

const PAGE_DESCRIPTIONS: Record<PageId, string> = {
    dashboard: 'Current battery state, status and positions across the fleet.',
    vehicles: 'Register vehicles and browse the fleet.',
    planner: 'Check whether a vehicle can finish a trip with its reserve intact.',
    route: 'Manila → Baguio example route via Marcos Highway, elevation profile and sample charging stops.',
    battery: 'Illustrative pack temperature, regen from your latest trip result, and reported SOH history.',
    history: 'Saved trip assessments: open any run, replay it on the route map, or rerun it.',
    garage: 'Browse the fleet in 3D and register new vehicles.',
};

// Only trips matching the map's route can be replayed on it.
const isMapRoute = (r: SimulationNumericParameters) => r.route_distance_km === ROUTE_DISTANCE_KM
    && r.elevation_gain_m === ROUTE_ELEVATION.gain && r.elevation_loss_m === ROUTE_ELEVATION.loss;

function readPage(): PageId {
    const id = window.location.hash.replace(/^#\/?/, '').split('/')[0];
    return PAGES.find(p => p.id === id)?.id ?? 'dashboard';
}

// `#/history/<id>` opens one saved assessment.
function readRecordId(): string | null {
    const [id, recordId] = window.location.hash.replace(/^#\/?/, '').split('/');
    if (id !== 'history' || !recordId) return null;
    try {
        return decodeURIComponent(recordId);
    } catch {
        return null; // a hand-typed malformed link shows the list instead
    }
}

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

        return { distance, soc: currentSocPct, kwh: cumulativeKwhUsed };
    });
}

// The backend returns totals only: keep a run's start and arrival SOC and spread the drop along
// the route in proportion to the local estimate's cumulative energy for that run's inputs.
function fitTripCurve({ request, response }: SimulationAssessment) {
    // Start SOC and capacity do not affect cumulative energy, only the efficiency and settings do.
    const shape = buildDynamicSocData(100, 1, response.vehicle_profile?.baseline_efficiency_wh_km ?? 160,
        request.driving_style, request.hvac_mode, request.regen_level, request.payload_kg);
    const totalKwh = shape[shape.length - 1].kwh;
    const { starting_soc_pct: start, projected_arrival_soc_pct: end } = response;
    return shape.map(p => {
        const used = totalKwh > 0 ? p.kwh / totalKwh : p.distance / ROUTE_DISTANCE_KM;
        return { ...p, soc: Math.max(0, start + (end - start) * used) };
    });
}

// Text for a replayed trip's chart note; negative arrival SOC reads as empty, as in the result.
const tripNote = (label: string, { response }: SimulationAssessment) =>
    `${label} ${response.vehicle_id}: starts at ${response.starting_soc_pct.toFixed(0)}% and arrives `
    + `${response.projected_arrival_soc_pct < 0 ? 'empty' : `at ${response.projected_arrival_soc_pct.toFixed(0)}%`} (backend). `
    + 'The curve between is a local estimate.';

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
    const { vehicles, telemetry, assessment, loading, error, simulationError, dataStatus, readingTime, lastFetchedAt, isSimulating, runSimulation, runBatchSimulation, runScenarioComparison, runDegradationProjection, getSimulationHistory, getSimulationRecord, getVehicleHistory, historyVersion, createVehicle, updateVehicle, deleteVehicle } = useFleetData();

    const [requestedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
    const selectedVehicleId = vehicles.some(vehicle => vehicle.id === requestedVehicleId)
        ? requestedVehicleId : vehicles[0]?.id ?? null;
    // Vehicles page: the vehicle loaded into the form; it drops out automatically if deleted.
    const [editingId, setEditingId] = useState<string | null>(null);
    const editingVehicle = vehicles.find(vehicle => vehicle.id === editingId) ?? null;
    const [selectedStationId, setSelectedStationId] = useState<string | null>(null);

    // Playback and vehicle controls
    const [isRunning, setIsRunning] = useState(true);
    const [speed, setSpeed] = useState(2);
    // A saved run's replay starts from Manila, also when its link is opened directly.
    const [progressFraction, setProgressFraction] = useState(() => readRecordId() ? 0 : 0.48);
    const [drivingStyle, setDrivingStyle] = useState<DrivingStyle>('NORMAL');
    const [hvacMode, setHvacMode] = useState<HvacMode>('LOW');
    const [regenLevel, setRegenLevel] = useState<RegenLevel>('MEDIUM');
    // Hash routing (#/planner) keeps deep links and the back button working without a router dependency.
    const [page, setPage] = useState<PageId>(readPage);
    const [recordId, setRecordId] = useState<string | null>(readRecordId);
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
        const onHashChange = () => {
            setPage(readPage());
            const nextRecordId = readRecordId();
            setRecordId(nextRecordId);
            if (nextRecordId) { // a saved run's replay starts from Manila
                setProgressFraction(0);
                setIsRunning(true);
            }
            headingRef.current?.focus(); // announce the new page to keyboard/screen-reader users
        };
        window.addEventListener('hashchange', onHashChange);
        return () => window.removeEventListener('hashchange', onHashChange);
    }, []);
    // The saved run whose replay is on screen: set once it has loaded and only if it is on the map's route.
    const [replayId, setReplayId] = useState<string | null>(null);
    const handleRecordLoad = useCallback((record: SimulationRecord) => {
        setReplayId(isMapRoute(record.request as Required<SimulationRequest>) ? record.id : null);
    }, []);
    // The preview only animates where it is visible, so other pages don't re-render every frame.
    const isAnimating = isRunning
        && (page === 'route' || page === 'battery' || (recordId !== null && replayId === recordId));

    // Vehicle IDs that saved runs refer to; the garage never assigns one of them to a new vehicle.
    const [savedRunIds, setSavedRunIds] = useState<string[]>([]);
    useEffect(() => {
        if (page !== 'garage' || dataStatus !== 'live') return;
        let cancelled = false;
        getSimulationHistory().then(
            records => { if (!cancelled) setSavedRunIds(records.map(r => r.request.vehicle_id)); },
            // shortcut: if this fails only current fleet IDs are avoided, show an error if ID reuse is reported.
            () => {},
        );
        return () => { cancelled = true; };
    }, [page, dataStatus, getSimulationHistory]);
    const [routeValues, setRouteValues] = useState<SimulationNumericDraft>({
        route_distance_km: String(ROUTE_DISTANCE_KM),
        elevation_gain_m: String(ROUTE_ELEVATION.gain),
        elevation_loss_m: String(ROUTE_ELEVATION.loss),
        ambient_temp_c: '31',
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

            if (isAnimating) {
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
    }, [isAnimating, speed]);

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (page === 'garage') return; // the garage owns Escape / arrows / number keys
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
    }, [vehicles, page]);

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

    // A current planner result for the map's own route can be played on it.
    const liveTrip = assessment && !assessmentOutdated
        && assessment.request.vehicle_id === selectedVehicleId && isMapRoute(assessment.request)
        ? assessment : null;
    const routeSocData = useMemo(() => liveTrip ? fitTripCurve(liveTrip) : socData, [liveTrip, socData]);
    const previewSoc = page === 'route' && liveTrip
        ? interpolateAtDistance(routeSocData, 'soc', progressFraction * ROUTE_DISTANCE_KM) : undefined;
    // Opens the route map at Manila and plays the live planner result.
    const playTrip = useCallback(() => {
        setProgressFraction(0);
        setIsRunning(true);
        window.location.hash = '#/route';
    }, []);
    // Set when a Manila → Baguio run is submitted. Once it finishes it plays only if the user is still
    // on the planner and the result still matches the form (liveTrip is null when it is outdated).
    const playWhenDone = useRef(false);
    useEffect(() => {
        if (!playWhenDone.current || isSimulating) return;
        playWhenDone.current = false;
        if (liveTrip && page === 'planner') playTrip();
    }, [isSimulating, liveTrip, page, playTrip]);

    // Compute pack thermal distribution
    const thermalGrid = useMemo(() => {
        return buildThermalGrid(selectedTelemetry?.pack_temp_c ?? 31.5, drivingStyle, progressFraction);
    }, [selectedTelemetry?.pack_temp_c, drivingStyle, progressFraction]);

    const allTemps = thermalGrid.flat();
    const maxTemp = Math.max(...allTemps);
    const avgTemp = allTemps.reduce((s, t) => s + t, 0) / allTemps.length;

    // ── Delegate simulation to backend via the hook ────────────────────
    // A Manila → Baguio trip opens on the route map and plays; other trips stay in the planner.
    const handleRunSimulation = (parameters: SimulationNumericParameters & { road_type: RoadType }) => {
        if (!selectedVehicleId || isSimulating) return;
        playWhenDone.current = isMapRoute(parameters);
        void runSimulation({
            ...parameters,
            vehicle_id: selectedVehicleId,
            driving_style: drivingStyle,
            hvac_mode: hvacMode,
            regen_level: regenLevel,
        });
    };

    // Reopen a saved run in the planner: the form shows its inputs, so the new result is not outdated.
    const handleRerun = (request: Required<SimulationRequest>) => {
        if (isSimulating) return;
        setRouteValues({
            route_distance_km: String(request.route_distance_km),
            elevation_gain_m: String(request.elevation_gain_m),
            elevation_loss_m: String(request.elevation_loss_m),
            ambient_temp_c: String(request.ambient_temp_c),
            payload_kg: String(request.payload_kg),
            reserve_soc_target_pct: String(request.reserve_soc_target_pct),
        });
        setRoadType(request.road_type);
        setDrivingStyle(request.driving_style);
        setHvacMode(request.hvac_mode);
        setRegenLevel(request.regen_level);
        setSelectedVehicleId(request.vehicle_id);
        window.location.hash = '#/planner';
        void runSimulation(request);
    };

    // The fleet starts empty; planner, route and battery need a vehicle to show anything real.
    // Vehicles, dashboard and garage render their own empty states; a saved run opens without one.
    const content = !loading && vehicles.length === 0 && page !== 'vehicles' && page !== 'dashboard' && page !== 'garage'
        && !(page === 'history' && recordId) ? 'empty' : page;
    const fleetEmpty = !loading && vehicles.length === 0;
    const openGarage = () => { window.location.hash = '#/garage'; };

    const vehiclePicker = (
        <label className="page-vehicle-picker">
            <span>Vehicle</span>
            <select value={selectedVehicleId ?? ''} onChange={e => setSelectedVehicleId(e.target.value)}>
                {vehicles.map(v => <option key={v.id} value={v.id}>{v.id} · {v.model}</option>)}
            </select>
        </label>
    );

    const mapPanel = (
        <MapPanel
            vehicles={vehicles}
            telemetry={telemetry}
            dataStatus={dataStatus}
            selectedVehicleId={selectedVehicleId}
            selectedStationId={selectedStationId}
            progressFraction={progressFraction}
            previewSoc={previewSoc}
            onSelectVehicle={setSelectedVehicleId}
            onSelectStation={setSelectedStationId}
            onProgressChange={setProgressFraction}
        />
    );

    const renderHistory = (maxRows?: number) => selectedVehicleId && (
        <AssessmentHistory
            vehicleId={selectedVehicleId}
            refreshKey={historyVersion}
            loadHistory={getSimulationHistory}
            maxRows={maxRows}
        />
    );
    const assessmentHistory = renderHistory();

    const controlsBar = (
        <div className="page-card">
            <ControlsBar
                isRunning={isRunning}
                onToggleRunning={() => setIsRunning(r => !r)}
                speed={speed}
                onSpeedChange={setSpeed}
                onReset={() => setProgressFraction(0)}
                progressFraction={progressFraction}
                onProgressChange={setProgressFraction}
                routeDistanceKm={ROUTE_DISTANCE_KM}
            />
        </div>
    );

    // A saved run played on the route map from its own result, not the vehicle's current state.
    const renderReplay = (trip: SimulationAssessment) => {
        if (!isMapRoute(trip.request)) return null;
        const curve = fitTripCurve(trip); // ~140 points, cheap enough to rebuild each frame
        return <>
            {controlsBar}
            <div className="page-grid page-grid--route page-grid--replay">
                <MapPanel
                    vehicles={vehicles}
                    telemetry={telemetry}
                    dataStatus={dataStatus}
                    selectedVehicleId={trip.request.vehicle_id}
                    selectedStationId={selectedStationId}
                    progressFraction={progressFraction}
                    previewSoc={interpolateAtDistance(curve, 'soc', progressFraction * ROUTE_DISTANCE_KM)}
                    onSelectStation={setSelectedStationId}
                    onProgressChange={setProgressFraction}
                />
                <ElevationChart
                    elevationData={ELEVATION_PROFILE}
                    socData={curve}
                    totalDistance={ROUTE_DISTANCE_KM}
                    progressFraction={progressFraction}
                    resultNote={tripNote('Saved run for', trip)}
                />
            </div>
        </>;
    };

    return (
        <div className="app-shell">
            <Sidebar page={page} dataStatus={dataStatus} lastFetchedAt={lastFetchedAt} />

            <main className="page">
                <header className="page-header">
                    <div>
                        <h1 ref={headingRef} tabIndex={-1}>{PAGES.find(p => p.id === page)?.label}</h1>
                        <p>{PAGE_DESCRIPTIONS[page]}</p>
                    </div>
                    {(content === 'route' || content === 'battery' || (content === 'history' && !recordId)) && vehiclePicker}
                </header>

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

                {content === 'empty' && (
                    <section className="empty-state" aria-labelledby="empty-title">
                        <h2 id="empty-title">No vehicles yet</h2>
                        <p>Add your first vehicle to see fleet data, plan trips and view battery details.</p>
                        <a className="simulate-btn" href="#/garage">Add a vehicle</a>
                    </section>
                )}

                {content === 'vehicles' && (
                    <div className="page-grid page-grid--vehicles">
                        {editingVehicle ? (
                            <VehicleForm
                                key={editingVehicle.id}
                                vehicles={vehicles}
                                canSubmit={dataStatus === 'live'}
                                editing={editingVehicle}
                                onUpdate={updateVehicle}
                                onStopEditing={() => setEditingId(null)}
                            />
                        ) : (
                            <section className="empty-state" aria-labelledby="garage-cta-title">
                                <h2 id="garage-cta-title">Fleet garage</h2>
                                <p>
                                    {vehicles.length === 0
                                        ? 'The garage is empty. Open it to register your first vehicle.'
                                        : 'Add new vehicles and look over the fleet in 3D.'}
                                </p>
                                <button
                                    type="button"
                                    className="simulate-btn"
                                    disabled={vehicles.length === 0 && dataStatus !== 'live'}
                                    onClick={openGarage}
                                >
                                    Open garage
                                </button>
                                {dataStatus !== 'live' && (
                                    <span className="route-field-hint">Connect to the fleet backend to add vehicles.</span>
                                )}
                            </section>
                        )}
                        <div className="vehicles-side">
                            {selectedVehicleId && selectedVehicle && (
                                <VehicleActions
                                    key={selectedVehicleId}
                                    vehicle={selectedVehicle}
                                    canSubmit={dataStatus === 'live'}
                                    isEditing={editingId === selectedVehicleId}
                                    onEdit={() => setEditingId(selectedVehicleId)}
                                    onDelete={deleteVehicle}
                                />
                            )}
                            <FleetPanel
                                vehicles={vehicles}
                                selectedId={selectedVehicleId}
                                onSelect={setSelectedVehicleId}
                            />
                        </div>
                    </div>
                )}

                {/* The 3D scene is built from the fleet on mount, so wait for the first fetch. */}
                {content === 'garage' && (loading ? <GaragePlaceholder /> : (
                    <Suspense fallback={<GaragePlaceholder />}>
                        <GaragePage
                            vehicles={vehicles}
                            selectedId={selectedVehicleId}
                            onSelect={setSelectedVehicleId}
                            onCreate={dataStatus === 'live' ? createVehicle : undefined}
                            retiredIds={savedRunIds}
                        />
                    </Suspense>
                ))}

                {content === 'dashboard' && fleetEmpty && <>
                    <FleetSummary vehicles={vehicles} telemetry={telemetry} />
                    <div className="page-grid page-grid--dashboard-empty">
                        <div className="area-map">{mapPanel}</div>
                        <FleetOnboarding
                            canAdd={dataStatus === 'live'}
                            onOpenGarage={openGarage}
                        />
                    </div>
                </>}

                {content === 'dashboard' && !fleetEmpty && <>
                    <FleetSummary vehicles={vehicles} telemetry={telemetry} />
                    <div className="page-grid page-grid--dashboard">
                        <div className="area-map">{mapPanel}</div>
                        <FleetPanel
                            vehicles={vehicles}
                            selectedId={selectedVehicleId}
                            onSelect={setSelectedVehicleId}
                        />
                        <StatusBreakdown vehicles={vehicles} />
                        <div className="panel area-history">{assessmentHistory}</div>
                    </div>
                </>}

                {content === 'planner' && <>
                    {simulationError && (
                        <div className="api-banner api-banner--error" role="alert">
                            Simulation unavailable: {simulationError}
                        </div>
                    )}
                    <div className="planner-layout">
                    <div className="page-card planner-setup">
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
                    </div>
                    {assessment ? (
                        <SimulationResult
                            assessment={assessment}
                            isOutdated={assessmentOutdated}
                        >
                            {liveTrip ? (
                                <button type="button" className="simulate-btn" onClick={() => playTrip()}>
                                    Play this trip on the route map
                                </button>
                            ) : !assessmentOutdated && (
                                <p className="assessment-note">Only the Manila → Baguio trip can be played on the route map.</p>
                            )}
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
                            <ScenarioComparison
                                assessment={assessment}
                                isOutdated={assessmentOutdated}
                                isConnected={dataStatus === 'live'}
                                runComparison={runScenarioComparison}
                                onUseSetup={setup => {
                                    setDrivingStyle(setup.driving_style);
                                    setHvacMode(setup.hvac_mode);
                                    setRegenLevel(setup.regen_level);
                                }}
                            />
                            <DegradationOutlook
                                assessment={assessment}
                                isOutdated={assessmentOutdated}
                                isConnected={dataStatus === 'live'}
                                runProjection={runDegradationProjection}
                            />
                        </SimulationResult>
                    ) : (
                        <section className="assessment-result assessment-result--empty" aria-label="Trip result">
                            <div className="charge-runway charge-runway--empty" aria-hidden="true" />
                            <h2>No result yet</h2>
                            <p>Set up the trip, then press Simulate trip. The result shows how much battery is left on arrival.</p>
                        </section>
                    )}
                    </div>
                    <div className="page-card">{assessmentHistory}</div>
                </>}

                {content === 'history' && (recordId ? (
                    <AssessmentDetail
                        recordId={recordId}
                        loadRecord={getSimulationRecord}
                        onLoad={handleRecordLoad}
                        onRerun={handleRerun}
                        rerunBlocked={dataStatus !== 'live' ? 'Reconnect to the backend to rerun this assessment.'
                            : isSimulating ? 'A simulation is already running.' : null}
                        renderReplay={renderReplay}
                    />
                ) : <div className="page-card">{renderHistory(Infinity)}</div>)}

                {content === 'route' && <>
                    {controlsBar}
                    <div className="page-grid page-grid--route">
                        {mapPanel}
                        <ElevationChart
                            elevationData={ELEVATION_PROFILE}
                            socData={routeSocData}
                            totalDistance={ROUTE_DISTANCE_KM}
                            progressFraction={progressFraction}
                            resultNote={liveTrip ? tripNote('Your Trip planner result for', liveTrip) : undefined}
                        />
                        <ChargingPanel
                            vehicles={vehicles}
                            selectedVehicleId={selectedVehicleId}
                            selectedStationId={selectedStationId}
                            onSelectStation={setSelectedStationId}
                        />
                    </div>
                </>}

                {content === 'battery' && (
                    <div className="page-grid page-grid--battery">
                        <ThermalMap
                            cellTemps={thermalGrid}
                            maxTemp={maxTemp}
                            avgTemp={avgTemp}
                            packHealthPct={activeVehicle.current_soh}
                            readingLabel={selectedTelemetry
                                ? `${dataStatus === 'demo' ? 'Demo' : 'Reported'} pack temperature: ${selectedTelemetry.pack_temp_c.toFixed(1)}°C · ${formatReadingAge(selectedTelemetry.timestamp, readingTime)}`
                                : 'Pack temperature unavailable · Illustrative baseline 31.5°C'}
                        />
                        <BatteryHealthChart
                            vehicles={vehicles}
                            selectedVehicleId={selectedVehicleId}
                            isDemo={dataStatus === 'demo'}
                            isConnected={dataStatus === 'live'}
                            loadHistory={getVehicleHistory}
                        />
                        <RegenBrakingPanel
                            vehicleId={selectedVehicleId}
                            assessment={assessment && !assessmentOutdated ? assessment : null}
                        />
                    </div>
                )}
            </main>
        </div>
    );
}

export default App;
