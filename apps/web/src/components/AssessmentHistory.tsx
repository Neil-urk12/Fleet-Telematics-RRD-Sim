import { useEffect, useState } from 'react';
import type { SimulationRecord } from '@fleet/api-client';

interface AssessmentHistoryProps {
    vehicleId: string;
    /** Changes whenever a new assessment completes, triggering a reload. */
    refreshKey: unknown;
    loadHistory: (vehicleId: string) => Promise<SimulationRecord[]>;
}

type HistoryResult = { vehicleId: string } & (
    | { status: 'error'; message: string }
    | { status: 'ready'; records: SimulationRecord[] });

const MAX_ROWS = 10;
const fmt = (value: number | undefined, unit: string) => value === undefined ? '—' : `${value}${unit}`;

export function AssessmentHistory({ vehicleId, refreshKey, loadHistory }: AssessmentHistoryProps) {
    const [result, setResult] = useState<HistoryResult | null>(null);
    // Keep this vehicle's previous rows visible while it reloads; only a vehicle switch shows loading.
    const state = result && result.vehicleId === vehicleId ? result : { status: 'loading' as const };

    useEffect(() => {
        let cancelled = false;
        // shortcut: fetches the vehicle's full history, add a backend limit if lists grow large
        loadHistory(vehicleId).then(
            records => {
                if (cancelled) return;
                const newest = [...records]
                    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
                    .slice(0, MAX_ROWS);
                setResult({ vehicleId, status: 'ready', records: newest });
            },
            err => {
                if (!cancelled) setResult({
                    vehicleId, status: 'error',
                    message: err instanceof Error ? err.message : 'Request failed',
                });
            },
        );
        return () => { cancelled = true; };
    }, [vehicleId, refreshKey, loadHistory]);

    return (
        <section className="fleet-comparison" aria-label="Recent saved assessments">
            <div className="sim-result-header">
                <h3>Recent assessments · {vehicleId}</h3>
            </div>
            {state.status === 'loading' && <p role="status">Loading saved assessments…</p>}
            {state.status === 'error' && (
                <p className="assessment-outdated" role="alert">Saved assessments unavailable: {state.message}</p>
            )}
            {state.status === 'ready' && state.records.length === 0 && (
                <p role="status">No saved assessments for this vehicle yet.</p>
            )}
            {state.status === 'ready' && state.records.length > 0 && (
                <div className="fleet-comparison-scroll" tabIndex={0} aria-label="Saved assessments table">
                    <table className="fleet-comparison-table">
                        <caption>Saved backend assessments · Heuristic PoC model · Newest first</caption>
                        <thead><tr>
                            <th scope="col">Saved</th>
                            <th scope="col">Risk</th>
                            <th scope="col">Arrival SOC / reserve</th>
                            <th scope="col">Confidence</th>
                            <th scope="col">Conditions</th>
                        </tr></thead>
                        <tbody>{state.records.map(({ id, timestamp, request, response }) => (
                            <tr key={id}>
                                <th scope="row">{new Date(timestamp).toLocaleString()}</th>
                                <td><span className={`risk-badge risk-badge--${response.risk_level.toLowerCase()}`}>
                                    {response.risk_level.replaceAll('_', ' ')}
                                </span></td>
                                <td>{response.projected_arrival_soc_pct.toFixed(1)}% / {fmt(request.reserve_soc_target_pct, '%')}</td>
                                <td>{response.confidence_score_pct.toFixed(0)}%</td>
                                <td>
                                    {fmt(request.route_distance_km, ' km')} · ↑{fmt(request.elevation_gain_m, ' m')}
                                    {' '}↓{fmt(request.elevation_loss_m, ' m')} · {fmt(request.ambient_temp_c, '°C')}
                                </td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
