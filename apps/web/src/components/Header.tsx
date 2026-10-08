interface HeaderProps {
    fleetCount: number;
    routeDistance: number;
    batteryHealth: number;
}

export function Header({ fleetCount, routeDistance, batteryHealth }: HeaderProps) {
    return (
        <header className="dashboard-header">
            <div className="header-left">
                <h1 className="header-title">
                    EV FLEET TELEMATICS — ROUTE DEGRADATION SIMULATOR
                </h1>
                <span className="header-subtitle">
                    DEMO ROUTE GT-6 PORTLAND → BEND&nbsp;|&nbsp;ILLUSTRATIVE PLAYBACK
                </span>
            </div>

            <div className="header-stats">
                <StatCard label="FLEET VEHICLES" value={`${fleetCount} REGISTERED`} />
                <StatCard label="DEMO ROUTE DISTANCE" value={`${routeDistance} KM`} />
                <StatCard label="AVG BATTERY AGE" value="Unavailable" />
                <StatCard label="FLEET SOH" value={`${batteryHealth}%`} />
            </div>
        </header>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="stat-card">
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
        </div>
    );
}
