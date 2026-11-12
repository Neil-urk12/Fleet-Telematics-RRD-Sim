import { useState } from 'react';
import type {
    CompareSimulationRequest, CompareSimulationResponse, SimulationAssessment, SimulationConfig,
} from '@fleet/api-client';

export type ScenarioSetup = Required<SimulationConfig>;

const PRESETS: ScenarioSetup[] = [
    { label: 'Efficient', driving_style: 'ECO', hvac_mode: 'OFF', regen_level: 'HIGH' },
    { label: 'Comfort', driving_style: 'NORMAL', hvac_mode: 'HIGH', regen_level: 'MEDIUM' },
    { label: 'Hard driving', driving_style: 'AGGRESSIVE', hvac_mode: 'HIGH', regen_level: 'LOW' },
];

interface ScenarioComparisonProps {
    assessment: SimulationAssessment;
    isOutdated: boolean;
    isConnected: boolean;
    runComparison: (request: CompareSimulationRequest) => Promise<CompareSimulationResponse>;
    /** Loads a setup into the planner form; the user still has to simulate again. */
    onUseSetup: (setup: ScenarioSetup) => void;
}

export function ScenarioComparison({
    assessment, isOutdated, isConnected, runComparison, onUseSetup,
}: ScenarioComparisonProps) {
    // Results are kept with the assessment they were run for, so a new assessment clears them.
    const [comparison, setComparison] = useState<{
        assessment: SimulationAssessment; setups: ScenarioSetup[]; response: CompareSimulationResponse;
    } | null>(null);
    const [isComparing, setIsComparing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const reserve = assessment.request.reserve_soc_target_pct;
    const disabled = isComparing || isOutdated || !isConnected;

    const handleCompare = async () => {
        if (disabled) return;
        const { driving_style, hvac_mode, regen_level, ...route } = assessment.request;
        const setups = [
            { label: 'As submitted', driving_style, hvac_mode, regen_level },
            ...PRESETS.filter(p => p.driving_style !== driving_style || p.hvac_mode !== hvac_mode ||
                p.regen_level !== regen_level),
        ];
        setIsComparing(true);
        setComparison(null);
        setError(null);
        try {
            setComparison({ assessment, setups, response: await runComparison({ ...route, configs: setups }) });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Setup comparison failed');
        } finally {
            setIsComparing(false);
        }
    };

    // The backend returns one result per config, in the order sent.
    const rows = comparison?.assessment === assessment
        ? comparison.response.results.flatMap(({ response }, index) => {
            const setup = comparison.setups[index];
            return setup ? [{ setup, response }] : [];
        }).sort((a, b) => b.response.projected_arrival_soc_pct - a.response.projected_arrival_soc_pct)
        : [];

    return (
        <section className="fleet-comparison" aria-label="Driving setup comparison">
            <div className="sim-result-header">
                <h3>Compare driving setups</h3>
                <button type="button" className="ctrl-btn ctrl-btn--run" disabled={disabled} onClick={handleCompare}>
                    {isComparing ? 'Comparing…' : 'Compare driving setups'}
                </button>
            </div>
            <p>Same vehicle and route · {reserve}% arrival reserve · Each setup is saved as an assessment.</p>
            {isOutdated && <p role="status">Assess the current inputs and vehicle again before comparing.</p>}
            {!isConnected && <p role="status">Reconnect to the backend to compare setups.</p>}
            {isComparing && <p role="status">Assessing driving setups…</p>}
            {error && <p className="assessment-outdated" role="alert">Comparison unavailable: {error}</p>}
            {rows.length > 0 && (
                <div className="fleet-comparison-scroll" tabIndex={0} aria-label="Setup comparison table">
                    <table className="fleet-comparison-table">
                        <caption>Backend assessments · Heuristic PoC model · Sorted by highest arrival SOC</caption>
                        <thead><tr>
                            <th scope="col">Setup</th>
                            <th scope="col">Risk</th>
                            <th scope="col">Arrival SOC</th>
                            <th scope="col">Reserve margin</th>
                            <th scope="col">Energy</th>
                            <th scope="col">Action</th>
                        </tr></thead>
                        <tbody>{rows.map(({ setup, response }) => (
                            <tr key={setup.label}>
                                <th scope="row">
                                    {setup.label}
                                    <p>Driving {setup.driving_style} · HVAC {setup.hvac_mode} · Regen {setup.regen_level}</p>
                                </th>
                                <td><span className={`risk-badge risk-badge--${response.risk_level.toLowerCase()}`}>
                                    {response.risk_level.replaceAll('_', ' ')}
                                </span></td>
                                <td>{response.projected_arrival_soc_pct.toFixed(1)}%</td>
                                <td>{(response.projected_arrival_soc_pct - reserve).toFixed(1)} pp</td>
                                <td>{response.estimated_energy_consumption_kwh.toFixed(2)} kWh</td>
                                <td><button type="button" className="ctrl-btn ctrl-btn--run"
                                    aria-label={`Use the ${setup.label} setup in the trip form`}
                                    onClick={() => onUseSetup(setup)}>
                                    Use this setup
                                </button></td>
                            </tr>
                        ))}</tbody>
                    </table>
                </div>
            )}
        </section>
    );
}
