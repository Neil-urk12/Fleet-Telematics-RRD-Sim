import { formatBatteryState, formatSimulationConditions, getSimulationEnergyBreakdown } from '@fleet/api-client';
import type { SimulationAssessment } from '@fleet/api-client';

interface SimulationResultProps {
    assessment: SimulationAssessment;
    isOutdated: boolean;
}

export function SimulationResult({ assessment, isOutdated }: SimulationResultProps) {
    const { request, response: result } = assessment;
    const breakdown = getSimulationEnergyBreakdown(result);

    return (
        <section className="assessment-result" aria-label={`Route assessment for ${result.vehicle_id}`}>
            <div className="sim-result-header">
                <h2>Route assessment — {result.vehicle_id}</h2>
                <span className={`risk-badge risk-badge--${result.risk_level.toLowerCase()}`}>
                    {result.risk_level.replaceAll('_', ' ')}
                </span>
            </div>
            {isOutdated && (
                <p className="assessment-outdated" role="status">
                    Outdated result — inputs or vehicle state changed. Assess again to update.
                </p>
            )}
            <p className="assessment-note">Backend assessment · Heuristic PoC model</p>
            <div className="assessment-result-grid">
                <div>
                    <h3>Submitted conditions</h3>
                    {formatSimulationConditions(request).map(line => <p key={line}>{line}</p>)}
                    <p>
                        {formatBatteryState(result)} · Starting SOC {result.starting_soc_pct.toFixed(1)}%
                        {' / '}SOH {result.starting_soh_pct.toFixed(1)}%
                    </p>
                    <dl className="assessment-stats">
                        <div><dt>Arrival SOC</dt><dd>{result.projected_arrival_soc_pct.toFixed(1)}%</dd></div>
                        <div><dt>Remaining range</dt><dd>{result.remaining_range_km.toFixed(1)} km</dd></div>
                        <div><dt>Heuristic confidence</dt><dd>{result.confidence_score_pct.toFixed(0)}%</dd></div>
                    </dl>
                    <p className="assessment-note">Confidence is a fixed rule score, not a calibrated completion probability.</p>
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
                <div>
                    <h3>Recommendations</h3>
                    <ul className="assessment-recommendations">
                        {result.recommendations.map((recommendation, index) => <li key={index}>{recommendation}</li>)}
                    </ul>
                </div>
            </div>
        </section>
    );
}
