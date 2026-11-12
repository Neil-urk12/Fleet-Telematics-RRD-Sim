import type { SimulationAssessment } from '@fleet/api-client';

interface RegenBrakingPanelProps {
    vehicleId: string | null;
    /** The current (not outdated) planner result for this vehicle, or null. */
    assessment: SimulationAssessment | null;
}

export function RegenBrakingPanel({ vehicleId, assessment }: RegenBrakingPanelProps) {
    const recovered = assessment?.response.recovered_regen_energy_kwh;
    if (!assessment || recovered == null) {
        return (
            <div className="regen-panel" style={{ display: 'flex', flexDirection: 'column' }}>
                <div className="panel-header">
                    <h3 className="panel-title">REGEN ON YOUR TRIP</h3>
                </div>
                <p className="data-note">
                    No current trip result for {vehicleId ?? 'this vehicle'}. Run one in{' '}
                    <a href="#/planner">Trip planner</a> to see how much energy regen recovers on it.
                </p>
            </div>
        );
    }

    const { request, response: result } = assessment;
    // Gross route demand before regen; the backend caps recovery at it.
    const gross = (result.propulsion_energy_kwh ?? 0) + (result.hvac_energy_kwh ?? 0) + (result.climb_energy_kwh ?? 0);
    const sharePct = gross > 0 ? (recovered / gross) * 100 : 0;
    // Same 0.05 kWh/km floor the backend uses for remaining range.
    const kwhPerKm = Math.max(result.estimated_energy_consumption_kwh / request.route_distance_km, 0.05);

    return (
        <div className="regen-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <h3 className="panel-title">REGEN ON YOUR TRIP · {result.vehicle_id}</h3>
                <span className="panel-badge" style={{ color: 'var(--accent-green)' }}>
                    REGEN {request.regen_level}
                </span>
            </div>
            <p className="data-note">
                Backend estimate for the {request.route_distance_km} km trip with {request.elevation_loss_m} m of descent
                and {Math.round(result.vehicle_profile.regen_efficiency * 100)}% vehicle regen efficiency.
                Only descents are counted, not stop-and-go braking.
            </p>

            <div className="regen-stats-row">
                <div className="regen-stat">
                    <span className="stat-label">RECOVERED</span>
                    <span className="stat-value" style={{ color: 'var(--accent-green)', fontSize: '13px' }}>
                        +{recovered.toFixed(1)} kWh
                    </span>
                </div>
                <div className="regen-stat">
                    <span className="stat-label">OF ROUTE DEMAND</span>
                    <span className="stat-value" style={{ fontSize: '13px' }}>
                        {sharePct.toFixed(0)}%
                    </span>
                </div>
                <div className="regen-stat">
                    <span className="stat-label">≈ EXTRA RANGE</span>
                    <span className="stat-value" style={{ color: 'var(--accent-cyan)', fontSize: '13px' }}>
                        +{(recovered / kwhPerKm).toFixed(0)} km
                    </span>
                </div>
            </div>

            <div
                className="avail-bar-bg"
                role="img"
                aria-label={`Regen recovers ${sharePct.toFixed(0)}% of the ${gross.toFixed(1)} kWh route demand`}
            >
                <div className="avail-bar-fill" style={{ width: `${Math.min(100, sharePct)}%`, backgroundColor: 'var(--accent-green)' }} />
            </div>
            <p className="data-note">
                Route demand {gross.toFixed(1)} kWh − recovered {recovered.toFixed(1)} kWh ≈ net {result.estimated_energy_consumption_kwh.toFixed(1)} kWh.
                Extra range uses this trip's net consumption per km.
            </p>
        </div>
    );
}
