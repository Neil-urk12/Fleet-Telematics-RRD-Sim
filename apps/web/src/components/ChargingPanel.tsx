import { formatBatteryState } from '@fleet/api-client';
import type { SimulationResponse } from '@fleet/api-client';

interface ChargingPanelProps {
    vehicles: Array<{ id: string; current_soc: number; battery_capacity_kwh: number; status: string; model?: string }>;
    simulation: SimulationResponse | null;
    selectedVehicleId: string | null;
    selectedStationId?: string | null;
    onSelectStation?: (stationId: string) => void;
}

const CHARGING_STATIONS = [
    { id: 'CS-01', name: 'Mt Hood Charge Hub', type: 'DC Fast (150kW)', distance: 36.2, available: 3, total: 4, fee: '$0.38/kWh' },
    { id: 'CS-02', name: 'Cascade Summit Fast', type: 'Ultra-Fast (350kW)', distance: 77.8, available: 1, total: 2, fee: '$0.44/kWh' },
    { id: 'CS-03', name: 'Madras EV Station', type: 'Level 2 (50kW)', distance: 110.4, available: 5, total: 6, fee: '$0.28/kWh' },
];

function availabilityColor(avail: number, total: number) {
    const ratio = avail / total;
    if (ratio > 0.5) return 'var(--accent-green)';
    if (ratio > 0) return 'var(--accent-yellow)';
    return 'var(--accent-red)';
}

export function ChargingPanel({
    vehicles,
    simulation,
    selectedVehicleId,
    selectedStationId,
    onSelectStation,
}: ChargingPanelProps) {
    const selectedVehicle = vehicles.find(v => v.id === selectedVehicleId);

    // Estimate time to charge vehicle from current SOC to 80%
    const estimateChargeTime = (soc: number, capacityKwh: number, chargerKw: number) => {
        const energyNeeded = ((80 - Math.min(soc, 80)) / 100) * capacityKwh;
        if (energyNeeded <= 0) return 0;
        return (energyNeeded / (chargerKw * 0.88)) * 60; // factoring in 88% charging efficiency
    };

    return (
        <div className="charging-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <h3 className="panel-title">WAYPOINT CHARGING HUBS — ROUTE GT-6</h3>
                <span className="panel-badge" style={{ color: 'var(--accent-green)' }}>
                    ● {CHARGING_STATIONS.reduce((s, st) => s + st.available, 0)} PORTS OPEN
                </span>
            </div>

            {/* Simulation result HUD card for selected vehicle */}
            {simulation && selectedVehicle && simulation.vehicle_id === selectedVehicleId && (
                <div className="sim-result-card" style={{ marginBottom: '8px' }}>
                    <div className="sim-result-header">
                        <span className="ctrl-label" style={{ color: '#00c2ff', fontWeight: 700 }}>
                            ⚡ SIMULATION PROJECTION — {selectedVehicleId}
                        </span>
                        <span className={`risk-badge risk-badge--${simulation.risk_level.toLowerCase()}`}>
                            {simulation.risk_level} MARGIN
                        </span>
                    </div>
                    <div className="sim-recommendation">
                        {formatBatteryState(simulation)} · Starting SOC {simulation.starting_soc_pct.toFixed(1)}%
                        {' / '}SOH {simulation.starting_soh_pct.toFixed(1)}%
                    </div>
                    <div className="sim-result-stats">
                        <div>
                            <span className="stat-label">ARRIVAL SOC</span>
                            <span
                                className="stat-value"
                                style={{
                                    fontSize: '13px',
                                    color:
                                        simulation.projected_arrival_soc_pct > 20
                                            ? 'var(--accent-green)'
                                            : simulation.projected_arrival_soc_pct > 10
                                            ? 'var(--accent-yellow)'
                                            : 'var(--accent-red)',
                                }}
                            >
                                {simulation.projected_arrival_soc_pct.toFixed(1)}%
                            </span>
                        </div>
                        <div>
                            <span className="stat-label">ENERGY USE</span>
                            <span className="stat-value" style={{ fontSize: '13px' }}>
                                {simulation.estimated_energy_consumption_kwh.toFixed(1)} kWh
                            </span>
                        </div>
                        <div>
                            <span className="stat-label">REMAINING RANGE</span>
                            <span className="stat-value" style={{ fontSize: '13px', color: 'var(--accent-cyan)' }}>
                                {simulation.remaining_range_km.toFixed(0)} km
                            </span>
                        </div>
                        <div>
                            <span className="stat-label">CONFIDENCE</span>
                            <span className="stat-value" style={{ fontSize: '13px' }}>
                                {simulation.confidence_score_pct.toFixed(0)}%
                            </span>
                        </div>
                    </div>
                    {simulation.recommendations.length > 0 && (
                        <div className="sim-recommendation">
                            💡 {simulation.recommendations[0]}
                        </div>
                    )}
                </div>
            )}

            {/* Charging stations list */}
            <div className="charging-station-list" style={{ flex: 1, overflowY: 'auto' }}>
                {CHARGING_STATIONS.map(st => {
                    const chargerKw = st.type.includes('350') ? 350 : st.type.includes('150') ? 150 : 50;
                    const chargeTime = selectedVehicle
                        ? estimateChargeTime(selectedVehicle.current_soc, selectedVehicle.battery_capacity_kwh, chargerKw)
                        : null;
                    const isSelected = st.id === selectedStationId;

                    return (
                        <div
                            key={st.id}
                            className={`charging-station-card ${isSelected ? 'charging-station-card--selected' : ''}`}
                            onClick={() => onSelectStation?.(st.id)}
                            style={{
                                cursor: 'pointer',
                                borderLeft: isSelected ? '3px solid var(--accent-cyan)' : undefined,
                            }}
                        >
                            <div className="charging-station-top">
                                <div>
                                    <div className="charging-station-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                        {st.name}
                                        {st.id === 'CS-02' && (
                                            <span style={{ fontSize: '8px', padding: '1px 4px', background: 'rgba(0,194,255,0.15)', color: 'var(--accent-cyan)', borderRadius: '2px' }}>
                                                RECOMMENDED
                                            </span>
                                        )}
                                    </div>
                                    <div className="charging-station-type">{st.type} &bull; {st.fee}</div>
                                </div>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ color: availabilityColor(st.available, st.total), fontFamily: 'var(--font-mono)', fontSize: '13px', fontWeight: 700 }}>
                                        {st.available}/{st.total}
                                    </div>
                                    <div className="charging-station-type">AVAILABLE</div>
                                </div>
                            </div>

                            <div className="charging-station-details">
                                <span className="charging-detail">
                                    📍 Milepost {st.distance} km
                                </span>
                                {chargeTime !== null && (
                                    <span className="charging-detail" style={{ color: 'var(--accent-cyan)' }}>
                                        ⏱ ~{Math.round(chargeTime)} min to 80%
                                    </span>
                                )}
                            </div>

                            {/* Availability capacity gauge bar */}
                            <div className="avail-bar-bg">
                                <div
                                    className="avail-bar-fill"
                                    style={{
                                        width: `${(st.available / st.total) * 100}%`,
                                        backgroundColor: availabilityColor(st.available, st.total),
                                    }}
                                />
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
