import { useState } from 'react';
import { formatBatteryState, isAssessmentOutdated } from '@fleet/api-client';
import type {
    BatchSimulationRequest, BatchSimulationResponse, SimulationAssessment, SimulationRequest, Vehicle,
} from '@fleet/api-client';

interface FleetComparisonProps {
    assessment: SimulationAssessment;
    currentRequest: Required<SimulationRequest> | null;
    vehicles: Vehicle[];
    isOutdated: boolean;
    isConnected: boolean;
    readingTime: number;
    runComparison: (request: BatchSimulationRequest) => Promise<BatchSimulationResponse>;
    onSelectAndAssess: (vehicleId: string) => void;
}

export function FleetComparison({
    assessment, currentRequest, vehicles, isOutdated, isConnected, readingTime,
    runComparison, onSelectAndAssess,
}: FleetComparisonProps) {
    const [comparison, setComparison] = useState<BatchSimulationResponse | null>(null);
    const [isComparing, setIsComparing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const availableVehicles = vehicles.filter(vehicle => vehicle.status === 'AVAILABLE');
    const reserve = assessment.request.reserve_soc_target_pct;

    const handleCompare = async () => {
        if (isComparing || isOutdated || !isConnected || !availableVehicles.length) return;
        setIsComparing(true);
        setComparison(null);
        setError(null);
        const { vehicle_id: _vehicleId, ...conditions } = assessment.request;
        try {
            setComparison(await runComparison({
                ...conditions,
                vehicle_ids: availableVehicles.map(vehicle => vehicle.id),
            }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Fleet comparison failed');
        } finally {
            setIsComparing(false);
        }
    };

    const rows = (comparison?.results ?? []).map(item => {
        const vehicle = vehicles.find(vehicle => vehicle.id === item.vehicle_id);
        const outdated = !vehicle || vehicle.status !== 'AVAILABLE' || !currentRequest ||
            (item.response ? isAssessmentOutdated({
                request: { ...assessment.request, vehicle_id: item.vehicle_id },
                response: item.response,
                origin: 'backend',
            }, { ...currentRequest, vehicle_id: item.vehicle_id }, vehicle) : false);
        return { ...item, vehicle, outdated };
    }).sort((a, b) =>
        (b.response?.projected_arrival_soc_pct ?? -Infinity) -
        (a.response?.projected_arrival_soc_pct ?? -Infinity)
    );
    const alternative = !isOutdated && isConnected && assessment.response.risk_level !== 'SAFE'
        ? rows.find(row => !row.outdated && row.vehicle_id !== assessment.request.vehicle_id &&
            row.response?.risk_level === 'SAFE') : undefined;

    return (
        <section className="fleet-comparison" aria-label="Available vehicle comparison">
            <div className="sim-result-header">
                <h3>Compare available vehicles</h3>
                <button type="button" className="ctrl-btn ctrl-btn--run"
                    disabled={isComparing || isOutdated || !isConnected || !availableVehicles.length}
                    onClick={handleCompare}>
                    {isComparing ? 'Comparing…' : 'Compare available vehicles'}
                </button>
            </div>
            <p>Same submitted conditions · {reserve}% arrival reserve · Sorted by highest reserve margin.</p>
            {!availableVehicles.length && <p role="status">No available vehicles to compare.</p>}
            {isOutdated && <p role="status">Assess the current inputs and vehicle again before comparing.</p>}
            {!isConnected && <p role="status">Reconnect to the backend to compare or select an alternative.</p>}
            {isComparing && <p role="status">Assessing available vehicles…</p>}
            {error && <p className="assessment-outdated" role="alert">Comparison unavailable: {error}</p>}
            {alternative && (
                <p role="status">Consider {alternative.vehicle?.name} ({alternative.vehicle_id}):
                    {' '}it meets the arrival reserve under these conditions. Select and assess to confirm.</p>
            )}
            {comparison && rows.length === 0 && <p role="status">No comparison results returned.</p>}
            {rows.length > 0 && (
                <div className="fleet-comparison-scroll" tabIndex={0} aria-label="Comparison table">
                    <table className="fleet-comparison-table">
                        <caption>Backend assessments · Heuristic PoC model · Reserve margin in percentage points</caption>
                        <thead><tr>
                            <th scope="col">Vehicle / battery reading</th>
                            <th scope="col">Risk</th>
                            <th scope="col">Arrival SOC</th>
                            <th scope="col">Reserve margin</th>
                            <th scope="col">Energy</th>
                            <th scope="col">Action</th>
                        </tr></thead>
                        <tbody>{rows.map(({ vehicle_id, response, error, vehicle, outdated }) => (
                            <tr key={vehicle_id}>
                                <th scope="row">
                                    {vehicle?.name ?? vehicle_id} ({vehicle_id})
                                    {vehicle_id === assessment.request.vehicle_id && ' · Assessed vehicle'}
                                    {response && <p>{formatBatteryState(response, readingTime)}</p>}
                                    {outdated && <p className="assessment-outdated">Outdated result — inputs, vehicle state or availability changed. Compare again.</p>}
                                </th>
                                {response ? <>
                                    <td><span className={`risk-badge risk-badge--${response.risk_level.toLowerCase()}`}>
                                        {response.risk_level.replaceAll('_', ' ')}
                                    </span></td>
                                    <td>{response.projected_arrival_soc_pct.toFixed(1)}%</td>
                                    <td>{(response.projected_arrival_soc_pct - reserve).toFixed(1)} pp</td>
                                    <td>{response.estimated_energy_consumption_kwh.toFixed(2)} kWh</td>
                                </> : <td colSpan={4}>{error ?? 'Assessment unavailable'}</td>}
                                <td><button type="button" className="ctrl-btn ctrl-btn--run"
                                    aria-label={`Select and assess ${vehicle?.name ?? vehicle_id} (${vehicle_id})`}
                                    disabled={!response || outdated || isOutdated || !isConnected || isComparing}
                                    onClick={() => onSelectAndAssess(vehicle_id)}>
                                    Select and assess
                                </button></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
