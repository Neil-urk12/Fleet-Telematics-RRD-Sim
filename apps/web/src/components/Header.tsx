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
                    EV Trip Range Checker
                </h1>
                <span className="header-subtitle">
                    EV Fleet Telematics · Route Range Degradation Simulator
                </span>
            </div>

            <div className="header-stats">
                <StatCard label="Vehicles" value={`${fleetCount}`} />
                <StatCard label="Demo route" value={`${routeDistance} km`} />
                <StatCard label="Avg battery health" value={`${batteryHealth}%`} />
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
