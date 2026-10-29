import { formatBatteryHistory, formatBatteryState, formatSimulationConditions, getSimulationEnergyBreakdown } from '@fleet/api-client';
import type { ReactNode } from 'react';
import type { SimulationAssessment, SimulationResponse } from '@fleet/api-client';

interface SimulationResultProps {
    assessment: SimulationAssessment;
    isOutdated: boolean;
    children?: ReactNode;
}

// Plain-language verdict for the backend risk level; arrival SOC may be negative.
function getVerdict(result: SimulationResponse, reservePct: number) {
    // Floor so a near-miss never reads as meeting the margin (14.6% vs 15%).
    const arrival = Math.floor(result.projected_arrival_soc_pct);
    const runsOut = result.projected_arrival_soc_pct < 0;
    if (result.risk_level === 'SAFE') {
        return {
            mark: '✓',
            title: "Yes, you'll make it",
            detail: `You should arrive with about ${arrival}% battery, above your ${reservePct}% safety margin.`,
        };
    }
    if (result.risk_level === 'CAUTION') {
        return {
            mark: '!',
            title: "You'll make it, but it's close",
            detail: `You should arrive with about ${arrival}% battery, below your ${reservePct}% safety margin.`,
        };
    }
    return {
        mark: '✕',
        title: runsOut ? 'The battery runs out before you arrive' : 'Charge before this trip',
        detail: runsOut
            ? `You'd be about ${Math.ceil(-result.projected_arrival_soc_pct)}% of a full battery short. Plan a charging stop or choose another vehicle.`
            : `Only about ${arrival}% battery would be left, well below your ${reservePct}% safety margin.`,
    };
}

export function SimulationResult({ assessment, isOutdated, children }: SimulationResultProps) {
    const { request, response: result } = assessment;
    const breakdown = getSimulationEnergyBreakdown(result);
    // Backend default reserve is 15%.
    const verdict = getVerdict(result, request.reserve_soc_target_pct ?? 15);

    return (
        <section className="assessment-result" aria-label={`Trip result for ${result.vehicle_id}`}>
            {isOutdated && (
                <p className="assessment-outdated" role="status">
                    You changed something since this result. Press Simulate trip again to update it.
                </p>
            )}
            <div className={`verdict verdict--${result.risk_level.toLowerCase()}`} role="status">
                <span className="verdict-mark" aria-hidden="true">{verdict.mark}</span>
                <div>
                    <h2>{verdict.title}</h2>
                    <p>{verdict.detail}</p>
                    <p className="assessment-note">{result.vehicle_id} · estimate from the backend model</p>
                </div>
            </div>

            <dl className="verdict-stats">
                <div><dt>Battery on arrival</dt><dd>{result.projected_arrival_soc_pct < 0 ? 'Empty' : `${Math.floor(result.projected_arrival_soc_pct)}%`}</dd></div>
                <div><dt>Range left after trip</dt><dd>{result.remaining_range_km.toFixed(0)} km</dd></div>
                <div><dt>Energy used</dt><dd>{result.estimated_energy_consumption_kwh.toFixed(1)} kWh</dd></div>
            </dl>

            <h3>What you can do</h3>
            <ul className="assessment-recommendations">
                {result.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}
            </ul>

            <details className="assessment-details">
                <summary>How this was calculated</summary>
                <div className="assessment-result-grid">
                    <div>
                        <h3>Submitted conditions</h3>
                        {formatSimulationConditions(request).map(line => <p key={line}>{line}</p>)}
                        <p>
                            {formatBatteryState(result)} · Starting SOC {result.starting_soc_pct.toFixed(1)}%
                            {' / '}SOH {result.starting_soh_pct.toFixed(1)}%
                        </p>
                        <p>{formatBatteryHistory(result.battery_history)}</p>
                        <dl className="assessment-stats">
                            <div><dt>Arrival SOC</dt><dd>{result.projected_arrival_soc_pct.toFixed(1)}%</dd></div>
                            <div><dt>Heuristic confidence</dt><dd>{result.confidence_score_pct.toFixed(0)}%</dd></div>
                        </dl>
                        <p className="assessment-note">Backend assessment · Heuristic PoC model. Confidence is a fixed rule score, not a calibrated completion probability.</p>
                    </div>
                    <div>
                        <h3>Route energy</h3>
                        {breakdown ? (
                            <dl className="assessment-energy">
                                {breakdown.map(component => (
                                    <div key={component.label}>
                                        <dt>{component.label}{component.recovered ? ' (subtract)' : ''}</dt>
                                        <dd>{component.value.toFixed(2)} kWh</dd>
                                    </div>
                                ))}
                                <div className="assessment-energy-total">
                                    <dt>Net consumption</dt><dd>{result.estimated_energy_consumption_kwh.toFixed(2)} kWh</dd>
                                </div>
                            </dl>
                        ) : (
                            <p>Net consumption: {result.estimated_energy_consumption_kwh.toFixed(2)} kWh. Energy breakdown unavailable.</p>
                        )}
                        <p className="assessment-note">Components are rounded separately; their sum may differ slightly from net consumption.</p>
                    </div>
                </div>
            </details>
            {children}
        </section>
    );
}
