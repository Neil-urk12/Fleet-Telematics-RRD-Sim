import { useState } from 'react';
import type { DegradationResponse, SimulationAssessment, SimulationRequest } from '@fleet/api-client';

interface DegradationOutlookProps {
    assessment: SimulationAssessment;
    isOutdated: boolean;
    isConnected: boolean;
    runProjection: (request: SimulationRequest) => Promise<DegradationResponse>;
}

export function DegradationOutlook({ assessment, isOutdated, isConnected, runProjection }: DegradationOutlookProps) {
    // Results are kept with the assessment they were run for, so a new assessment clears them.
    const [projection, setProjection] = useState<{
        assessment: SimulationAssessment; response: DegradationResponse;
    } | null>(null);
    const [isProjecting, setIsProjecting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reserve = assessment.request.reserve_soc_target_pct;
    const disabled = isProjecting || isOutdated || !isConnected;

    const handleProject = async () => {
        if (disabled) return;
        setIsProjecting(true);
        setProjection(null);
        setError(null);
        try {
            setProjection({ assessment, response: await runProjection(assessment.request) });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Projection failed');
        } finally {
            setIsProjecting(false);
        }
    };

    const result = projection?.assessment === assessment ? projection.response : null;
    const rate = result && `${result.soh_loss_pct_per_year.toFixed(1)}% SOH lost per year`;

    return (
        <section className="fleet-comparison" aria-label="Battery ageing outlook">
            <div className="sim-result-header">
                <h3>Battery ageing outlook</h3>
                <button type="button" className="ctrl-btn ctrl-btn--run" disabled={disabled} onClick={handleProject}>
                    {isProjecting ? 'Projecting…' : 'Project battery ageing'}
                </button>
            </div>
            <p>Same trip and charge level at the battery health projected for later years · Not saved as assessments.</p>
            {isOutdated && <p role="status">Assess the current inputs and vehicle again before projecting.</p>}
            {!isConnected && <p role="status">Reconnect to the backend to project battery ageing.</p>}
            {isProjecting && <p role="status">Projecting battery ageing…</p>}
            {error && <p className="assessment-outdated" role="alert">Projection unavailable: {error}</p>}
            {result && (
                <div className="fleet-comparison-scroll" tabIndex={0} aria-label="Battery ageing table">
                    <table className="fleet-comparison-table">
                        <caption>
                            {result.basis === 'RECORDED'
                                ? `Recorded trend: ${rate}, fitted to ${result.readings_used} readings over ${result.span_days.toFixed(0)} days`
                                : `Assumed rate: ${rate} (illustrative; under 30 days of recorded SOH history)`}
                            {' · Heuristic PoC projection'}
                        </caption>
                        <thead><tr>
                            <th scope="col">When</th>
                            <th scope="col">Battery health</th>
                            <th scope="col">Risk</th>
                            <th scope="col">Arrival SOC</th>
                            <th scope="col">Reserve margin</th>
                            <th scope="col">Predicted range</th>
                        </tr></thead>
                        <tbody>{result.points.map(point => (
                            <tr key={point.years_ahead}>
                                <th scope="row">
                                    {point.years_ahead === 0 ? 'Today'
                                        : `In ${point.years_ahead} year${point.years_ahead === 1 ? '' : 's'}`}
                                </th>
                                <td>{point.projected_soh_pct.toFixed(1)}%</td>
                                <td><span className={`risk-badge risk-badge--${point.risk_level.toLowerCase()}`}>
                                    {point.risk_level.replaceAll('_', ' ')}
                                </span></td>
                                <td>{point.projected_arrival_soc_pct.toFixed(1)}%</td>
                                <td>{(point.projected_arrival_soc_pct - reserve).toFixed(1)} pp</td>
                                <td>{point.predicted_range_km.toFixed(0)} km</td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
