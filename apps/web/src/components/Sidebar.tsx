export const PAGES = [
    { id: 'dashboard', label: 'Dashboard', icon: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z' },
    { id: 'vehicles', label: 'Vehicles', icon: 'M1 4h14v11H1zM15 8h4l3 3v4h-7zM8 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM20 18a2 2 0 1 1-4 0 2 2 0 1 1 4 0z' },
    { id: 'garage', label: 'Garage', icon: 'M3 21V9l9-6 9 6v12M7 21v-9h10v9M7 15h10M7 18h10' },
    { id: 'planner', label: 'Trip planner', icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11' },
    { id: 'route', label: 'Route & charging', icon: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15' },
    { id: 'battery', label: 'Battery', icon: 'M2 7h16v10H2zM22 11v2M6 10v4M10 10v4' },
    { id: 'history', label: 'History', icon: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2' },
] as const;

export type PageId = typeof PAGES[number]['id'];

interface SidebarProps {
    page: PageId;
    dataStatus: 'demo' | 'live' | 'cached';
    lastFetchedAt: string | null;
}

export function Sidebar({ page, dataStatus, lastFetchedAt }: SidebarProps) {
    return (
        <nav className="sidebar" aria-label="Main">
            <div className="sidebar-brand">
                <span className="sidebar-title">Fleet Telematics</span>
                <span className="sidebar-subtitle">EV range decision support</span>
            </div>
            <ul className="sidebar-nav">
                {PAGES.map(p => (
                    <li key={p.id}>
                        <a
                            href={`#/${p.id}`}
                            className={`sidebar-link ${page === p.id ? 'sidebar-link--active' : ''}`}
                            aria-current={page === p.id ? 'page' : undefined}
                            aria-label={p.label}
                        >
                            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                                <path d={p.icon} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span>{p.label}</span>
                        </a>
                    </li>
                ))}
            </ul>
            <p className={`data-status data-status--${dataStatus}`}>
                <span className="data-status-dot" aria-hidden="true" />
                <span>
                    {dataStatus === 'live' ? 'Live fleet data' : dataStatus === 'cached' ? 'Saved fleet data' : 'Demo fleet data'}
                    {lastFetchedAt && <><br />updated {new Date(lastFetchedAt).toLocaleTimeString()}</>}
                </span>
            </p>
        </nav>
    );
}
