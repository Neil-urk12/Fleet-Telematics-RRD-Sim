import { useState, useCallback, useEffect, useRef } from 'react';
import { createFleetClient } from '@fleet/api-client';
import type { BatchSimulationRequest, Vehicle, TelemetryEvent, SimulationAssessment, SimulationRequest } from '@fleet/api-client';
import { MOCK_VEHICLES, MOCK_TELEMETRY } from '../mockData';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const api = createFleetClient({ baseUrl: API_BASE_URL });

export function useFleetData(pollingIntervalMs: number = 5000) {
    const [vehicles, setVehicles] = useState<Vehicle[]>(MOCK_VEHICLES);
    const [telemetry, setTelemetry] = useState<Record<string, TelemetryEvent>>(MOCK_TELEMETRY);
    const [assessment, setAssessment] = useState<SimulationAssessment | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [simulationError, setSimulationError] = useState<string | null>(null);
    const [dataStatus, setDataStatus] = useState<'demo' | 'live' | 'cached'>('demo');
    const [readingTime, setReadingTime] = useState(Date.now);
    const [lastFetchedAt, setLastFetchedAt] = useState<string | null>(null);
    const [isSimulating, setIsSimulating] = useState(false);
    const fetching = useRef(false);
    const hasBackendData = useRef(false);

    const fetchData = useCallback(async () => {
        if (fetching.current) return;
        fetching.current = true;
        try {
            const [vehicleList, fleetTelemetry] = await Promise.all([
                api.getVehicles(), api.getFleetLatestTelemetry(),
            ]);
            const vehicleIds = new Set(vehicleList.map(vehicle => vehicle.id));
            setVehicles(vehicleList);
            setTelemetry(Object.fromEntries(
                Object.entries(fleetTelemetry.data).filter(([id]) => vehicleIds.has(id))
            ));
            hasBackendData.current = true;
            setLastFetchedAt(new Date().toISOString());
            setDataStatus('live');
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to connect to fleet backend');
            setDataStatus(hasBackendData.current ? 'cached' : 'demo');
        } finally {
            fetching.current = false;
            setLoading(false);
        }
    }, []);

    const runSimulation = useCallback(async (req: Required<SimulationRequest>) => {
        const request = { ...req };
        setIsSimulating(true);
        setSimulationError(null);
        setAssessment(null);
        try {
            const response = await api.runSimulation(request);
            setAssessment({ request, response, origin: 'backend' });
        } catch (err) {
            setSimulationError(err instanceof Error ? err.message : 'Simulation failed');
        } finally {
            setIsSimulating(false);
        }
    }, []);

    const runBatchSimulation = useCallback((req: BatchSimulationRequest) => api.runBatchSimulation(req), []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(() => {
            setReadingTime(Date.now());
            void fetchData();
        }, pollingIntervalMs);
        return () => clearInterval(interval);
    }, [fetchData, pollingIntervalMs]);

    return {
        vehicles, telemetry, assessment, loading, error, simulationError, dataStatus,
        readingTime, lastFetchedAt,
        isSimulating, refetch: fetchData, runSimulation, runBatchSimulation,
    };
}
