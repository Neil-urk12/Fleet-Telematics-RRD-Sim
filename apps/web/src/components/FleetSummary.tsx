import type { TelemetryEvent, Vehicle } from '@fleet/api-client';
import { getStatusColor } from './FleetPanel';

const LOW_SOC_PCT = 30;
const STATUSES = ['AVAILABLE', 'IN_USE', 'CHARGING', 'MAINTENANCE'];

interface FleetSummaryProps {
    vehicles: Vehicle[];
    telemetry: Record<string, TelemetryEvent>;
}

const avg = (values: number[]) => values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0;

export function FleetSummary({ vehicles, telemetry }: FleetSummaryProps) {
    const reporting = vehicles.filter(v => telemetry[v.id]).length;
    const lowCharge = vehicles.filter(v => v.current_soc < LOW_SOC_PCT).length;
    const maintenance = vehicles.filter(v => v.status === 'MAINTENANCE').length;
    // An empty fleet has no averages; show placeholders rather than a misleading 0.0%.
    const none = vehicles.length === 0;
    const tone = none ? 'empty' : undefined;

    return (
        <div className="kpi-grid">
            <Kpi label="Vehicles" value={`${vehicles.length}`} note={none ? 'None registered yet' : `${reporting} reporting telemetry`} tone={tone} />
            <Kpi label="Avg charge" value={none ? '—' : `${avg(vehicles.map(v => v.current_soc)).toFixed(1)}%`} note="State of charge" tone={tone} />
            <Kpi label="Avg battery health" value={none ? '—' : `${avg(vehicles.map(v => v.current_soh)).toFixed(1)}%`} note="State of health" tone={tone} />
            <Kpi label="Low charge" value={none ? '—' : `${lowCharge}`} note={`Below ${LOW_SOC_PCT}% SOC`} tone={tone ?? (lowCharge ? 'warn' : undefined)} />
            <Kpi label="In maintenance" value={none ? '—' : `${maintenance}`} note="Unavailable for trips" tone={tone ?? (maintenance ? 'bad' : undefined)} />
        </div>
    );
}

interface FleetOnboardingProps {
    canAdd: boolean;
    onOpenGarage: () => void;
}

/** Dashboard with an empty fleet: the steps from first vehicle to live data. Only step 1 is actionable. */
export function FleetOnboarding({ canAdd, onOpenGarage }: FleetOnboardingProps) {
    return (
        <section className="onboarding" aria-labelledby="onboarding-title">
            <h2 className="onboarding-title" id="onboarding-title">Get your fleet on the dashboard</h2>
            <p className="onboarding-lede">This page fills in once your fleet has a vehicle.</p>
            <ol className="onboarding-steps">
                <li className="onboarding-step onboarding-step--current" aria-current="step">
                    <span className="onboarding-num" aria-hidden="true">1</span>
                    <div>
                        <h3>Register a vehicle</h3>
                        <p>Pick a known EV in the garage and give it an ID.</p>
                        <button type="button" className="simulate-btn" disabled={!canAdd} onClick={onOpenGarage}>
                            Open the garage
                        </button>
                        {!canAdd && <p className="route-field-hint">Connect to the fleet backend to add vehicles.</p>}
                    </div>
                </li>
                <li className="onboarding-step">
                    <span className="onboarding-num" aria-hidden="true">2</span>
                    <div>
                        <h3>Plan a trip</h3>
                        <p>Check whether a route fits the vehicle's remaining range.</p>
                    </div>
                </li>
                <li className="onboarding-step">
                    <span className="onboarding-num" aria-hidden="true">3</span>
                    <div>
                        <h3>Watch it here</h3>
                        <p>Charge, battery health and status update as telemetry arrives.</p>
                    </div>
                </li>
            </ol>
        </section>
    );
}

function Kpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'warn' | 'bad' | 'empty' }) {
    return (
        <div className={`kpi ${tone ? `kpi--${tone}` : ''}`}>
            <span className="kpi-label">{label}</span>
            <span className="kpi-value">{value}</span>
            <span className="kpi-note">{note}</span>
        </div>
    );
}

export function StatusBreakdown({ vehicles }: { vehicles: Vehicle[] }) {
    const others = vehicles.filter(v => !STATUSES.includes(v.status)).length;
    const rows = [...STATUSES.map(s => [s, vehicles.filter(v => v.status === s).length] as const),
        ...(others ? [['OTHER', others] as const] : [])];

    return (
        <section className="panel status-panel" aria-labelledby="status-title">
            <div className="panel-header">
                <h2 className="panel-title" id="status-title">FLEET STATUS</h2>
                <span className="panel-badge">{vehicles.length} VEHICLES</span>
            </div>
            <ul className="status-list">
                {rows.map(([status, count]) => (
                    <li key={status}>
                        <span className="status-name">{status.replace('_', ' ')}</span>
                        <span className="status-bar" aria-hidden="true">
                            <span style={{ width: `${vehicles.length ? (count / vehicles.length) * 100 : 0}%`, background: getStatusColor(status) }} />
                        </span>
                        <span className="status-count">{count}</span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
