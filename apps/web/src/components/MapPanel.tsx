import { useRef, useEffect, useState } from 'react';

// Route waypoints with geographic labels for Portland → Bend (GT-6)
export interface Waypoint {
    x: number;
    y: number;
    name?: string;
    elevationM?: number;
}

export const ROUTE_WAYPOINTS: Waypoint[] = [
    { x: 0.05, y: 0.44, name: 'Portland (PDX)', elevationM: 15 },
    { x: 0.16, y: 0.36, name: 'Sandy', elevationM: 220 },
    { x: 0.28, y: 0.42, name: 'Mt Hood Hub', elevationM: 850 },
    { x: 0.39, y: 0.52, name: 'Govt Camp Summit', elevationM: 1490 },
    { x: 0.51, y: 0.57, name: 'Warm Springs', elevationM: 1180 },
    { x: 0.63, y: 0.50, name: 'Cascade Descent', elevationM: 720 },
    { x: 0.74, y: 0.46, name: 'Madras Station', elevationM: 480 },
    { x: 0.86, y: 0.48, name: 'Redmond Hub', elevationM: 260 },
    { x: 0.95, y: 0.52, name: 'Bend (BND)', elevationM: 182 },
];

export const CHARGING_STATIONS = [
    { id: 'CS-01', x: 0.28, y: 0.42, name: 'Mt Hood Charge Hub', powerKw: 150, available: 3, total: 4, distKm: 36.2 },
    { id: 'CS-02', x: 0.63, y: 0.50, name: 'Cascade Summit Fast', powerKw: 350, available: 1, total: 2, distKm: 77.8 },
    { id: 'CS-03', x: 0.74, y: 0.46, name: 'Madras EV Station', powerKw: 50,  available: 5, total: 6, distKm: 110.4 },
];

interface MapPanelProps {
    vehicles: Array<{ id: string; current_soc: number; status: string; model?: string }>;
    selectedVehicleId: string | null;
    progressFraction: number; // 0–1 how far along the route
    onSelectVehicle?: (id: string) => void;
    onSelectStation?: (stationId: string) => void;
}

// Calculate interpolated point along a polyline at fractional distance t [0..1]
function getPointAlongPolyline(points: Waypoint[], t: number): { x: number; y: number; segmentIndex: number } {
    if (points.length === 0) return { x: 0, y: 0, segmentIndex: 0 };
    if (points.length === 1 || t <= 0) return { x: points[0].x, y: points[0].y, segmentIndex: 0 };
    if (t >= 1) {
        const last = points[points.length - 1];
        return { x: last.x, y: last.y, segmentIndex: points.length - 2 };
    }

    // Calculate segment lengths
    const segmentLengths: number[] = [];
    let totalLen = 0;
    for (let i = 0; i < points.length - 1; i++) {
        const dx = points[i + 1].x - points[i].x;
        const dy = points[i + 1].y - points[i].y;
        const len = Math.hypot(dx, dy);
        segmentLengths.push(len);
        totalLen += len;
    }

    const targetDistance = t * totalLen;
    let accumulated = 0;

    for (let i = 0; i < segmentLengths.length; i++) {
        const segLen = segmentLengths[i];
        if (accumulated + segLen >= targetDistance || i === segmentLengths.length - 1) {
            const segFraction = segLen > 0 ? (targetDistance - accumulated) / segLen : 0;
            const p1 = points[i];
            const p2 = points[i + 1];
            return {
                x: p1.x + (p2.x - p1.x) * segFraction,
                y: p1.y + (p2.y - p1.y) * segFraction,
                segmentIndex: i,
            };
        }
        accumulated += segLen;
    }

    const last = points[points.length - 1];
    return { x: last.x, y: last.y, segmentIndex: points.length - 2 };
}

export function MapPanel({
    vehicles,
    selectedVehicleId,
    progressFraction = 0.5,
    onSelectVehicle,
    onSelectStation,
}: MapPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);

        const W = rect.width;
        const H = rect.height;

        ctx.clearRect(0, 0, W, H);

        // 1. Terrain gradient background
        const bgGrad = ctx.createLinearGradient(0, 0, W, H);
        bgGrad.addColorStop(0, '#0a1322');
        bgGrad.addColorStop(0.45, '#0b1928');
        bgGrad.addColorStop(1, '#091520');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, W, H);

        // 2. Elevation contour lines / subtle topological texture
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
        ctx.lineWidth = 1;
        for (let r = 30; r < W + H; r += 45) {
            ctx.beginPath();
            ctx.arc(W * 0.38, H * 0.52, r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 3. Coordinate grid
        ctx.strokeStyle = 'rgba(30, 48, 70, 0.5)';
        ctx.lineWidth = 0.5;
        for (let gx = 0; gx <= W; gx += 48) {
            ctx.beginPath();
            ctx.moveTo(gx, 0);
            ctx.lineTo(gx, H);
            ctx.stroke();
        }
        for (let gy = 0; gy <= H; gy += 48) {
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(W, gy);
            ctx.stroke();
        }

        const toPixel = (p: { x: number; y: number }) => ({
            px: p.x * W,
            py: p.y * H,
        });

        // 4. Draw Full Planned Route (dashed, dim cyan)
        ctx.beginPath();
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(0, 194, 255, 0.22)';
        ctx.lineWidth = 2.5;
        ROUTE_WAYPOINTS.forEach((wp, i) => {
            const { px, py } = toPixel(wp);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        });
        ctx.stroke();
        ctx.setLineDash([]);

        // 5. Draw Completed Route Segment (bright cyan glow)
        const currentPt = getPointAlongPolyline(ROUTE_WAYPOINTS, progressFraction);
        const { segmentIndex } = currentPt;

        ctx.beginPath();
        ctx.strokeStyle = '#00c2ff';
        ctx.lineWidth = 3;
        ctx.shadowColor = 'rgba(0, 194, 255, 0.6)';
        ctx.shadowBlur = 10;

        for (let i = 0; i <= segmentIndex; i++) {
            const { px, py } = toPixel(ROUTE_WAYPOINTS[i]);
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        // Line to exact current progress point
        const curPx = toPixel(currentPt);
        ctx.lineTo(curPx.px, curPx.py);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 6. Draw Waypoint Nodes
        ROUTE_WAYPOINTS.forEach((wp, i) => {
            const { px, py } = toPixel(wp);
            const isStart = i === 0;
            const isEnd = i === ROUTE_WAYPOINTS.length - 1;
            const isSummit = i === 3;

            // Dot
            ctx.beginPath();
            ctx.arc(px, py, isStart || isEnd || isSummit ? 5 : 3, 0, Math.PI * 2);
            ctx.fillStyle = isStart ? '#10b981' : isEnd ? '#f59e0b' : isSummit ? '#ec4899' : 'rgba(122, 139, 166, 0.6)';
            ctx.fill();

            // Label
            if (isStart || isEnd || isSummit || i % 2 === 0) {
                ctx.fillStyle = 'rgba(226, 232, 240, 0.85)';
                ctx.font = '9px Inter, sans-serif';
                ctx.textAlign = 'center';
                const labelY = py + (i % 2 === 0 ? -10 : 16);
                ctx.fillText(wp.name || '', px, labelY);
            }
        });

        // 7. Draw Charging Stations
        CHARGING_STATIONS.forEach(st => {
            const { px, py } = toPixel(st);
            // Outer pulse halo
            const grd = ctx.createRadialGradient(px, py, 2, px, py, 14);
            grd.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
            grd.addColorStop(1, 'rgba(16, 185, 129, 0)');
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(px, py, 14, 0, Math.PI * 2);
            ctx.fill();

            // Inner circle
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#065f46';
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();

            // Bolt icon
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('⚡', px, py);
            ctx.textBaseline = 'alphabetic';

            // Station power label
            ctx.fillStyle = '#10b981';
            ctx.font = 'bold 8px "JetBrains Mono", monospace';
            ctx.fillText(`${st.powerKw}kW`, px, py + 14);
        });

        // 8. Draw Vehicles along the route
        vehicles.forEach((v, i) => {
            // Offset vehicle positions slightly along the route progress so they travel as a cohort
            const vehicleOffset = (i - vehicles.length / 2) * 0.035;
            const vehicleProg = Math.max(0.01, Math.min(0.99, progressFraction + vehicleOffset));
            const pt = getPointAlongPolyline(ROUTE_WAYPOINTS, vehicleProg);
            const { px, py } = toPixel(pt);

            // Perpendicular jitter so vehicles on the same segment don't overlap completely
            const perpY = py + (i % 2 === 0 ? -9 : 9);
            const isSelected = v.id === selectedVehicleId;
            const socColor = v.current_soc > 60 ? '#10b981' : v.current_soc > 30 ? '#f59e0b' : '#ef4444';

            if (isSelected) {
                // Expanding Animated Ring
                ctx.beginPath();
                ctx.arc(px, perpY, 12, 0, Math.PI * 2);
                ctx.strokeStyle = '#00c2ff';
                ctx.lineWidth = 2;
                ctx.shadowColor = '#00c2ff';
                ctx.shadowBlur = 12;
                ctx.stroke();
                ctx.shadowBlur = 0;

                // Selection tag
                ctx.fillStyle = '#00c2ff';
                ctx.font = 'bold 9px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`► ${v.id}`, px, perpY - 14);
            }

            // Vehicle Dot
            ctx.beginPath();
            ctx.arc(px, perpY, isSelected ? 7 : 5, 0, Math.PI * 2);
            ctx.fillStyle = socColor;
            ctx.strokeStyle = '#0b1320';
            ctx.lineWidth = 1.5;
            ctx.fill();
            ctx.stroke();

            // Vehicle label
            if (!isSelected) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
                ctx.font = '8px "JetBrains Mono", monospace';
                ctx.textAlign = 'center';
                ctx.fillText(v.id.replace('EV-', ''), px, perpY + 14);
            }
        });

        // 9. Status HUD Overlay in bottom right
        ctx.fillStyle = 'rgba(10, 19, 34, 0.85)';
        ctx.strokeStyle = 'var(--border-color, #1e2d3d)';
        ctx.lineWidth = 1;
        const hudW = 150;
        const hudH = 38;
        const hudX = W - hudW - 8;
        const hudY = H - hudH - 8;
        ctx.fillRect(hudX, hudY, hudW, hudH);
        ctx.strokeRect(hudX, hudY, hudW, hudH);

        ctx.fillStyle = '#00c2ff';
        ctx.font = 'bold 9px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`ROUTE DISTANCE: ${(progressFraction * 129.4).toFixed(1)} / 129.4 km`, hudX + 8, hudY + 15);
        ctx.fillStyle = '#7a8ba6';
        ctx.font = '8px Inter, sans-serif';
        ctx.fillText(`CORRIDOR: US-26 / OR-97 HIGHWAY`, hudX + 8, hudY + 28);

    }, [vehicles, selectedVehicleId, progressFraction]);

    // Canvas click handling to select vehicle or station
    const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const clickX = (e.clientX - rect.left) / rect.width;
        const clickY = (e.clientY - rect.top) / rect.height;

        // Check if user clicked near any charging station
        for (const st of CHARGING_STATIONS) {
            const dist = Math.hypot(st.x - clickX, st.y - clickY);
            if (dist < 0.05) {
                onSelectStation?.(st.id);
                setTooltip({
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                    content: `⚡ ${st.name} (${st.powerKw}kW) — ${st.available}/${st.total} Available`,
                });
                return;
            }
        }

        // Check if user clicked near any vehicle
        vehicles.forEach((v, i) => {
            const vehicleOffset = (i - vehicles.length / 2) * 0.035;
            const vehicleProg = Math.max(0.01, Math.min(0.99, progressFraction + vehicleOffset));
            const pt = getPointAlongPolyline(ROUTE_WAYPOINTS, vehicleProg);
            const dist = Math.hypot(pt.x - clickX, pt.y - clickY);
            if (dist < 0.06) {
                onSelectVehicle?.(v.id);
            }
        });
    };

    return (
        <div className="map-panel" style={{ padding: 0, position: 'relative', overflow: 'hidden' }}>
            <div
                className="panel-header"
                style={{
                    padding: '8px 12px',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    zIndex: 2,
                    background: 'linear-gradient(to bottom, rgba(11,19,32,0.95) 60%, transparent)',
                    pointerEvents: 'none',
                }}
            >
                <h3 className="panel-title">DEMO ROUTE PLAYBACK — GT-6 PORTLAND → BEND</h3>
                <span className="panel-badge" style={{ color: 'var(--accent-cyan)' }}>
                    ILLUSTRATIVE POSITIONS
                </span>
            </div>

            <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                style={{ width: '100%', height: '100%', display: 'block', cursor: 'pointer' }}
                title="Click vehicles or charging stations to inspect"
            />

            {tooltip && (
                <div
                    style={{
                        position: 'absolute',
                        left: tooltip.x,
                        top: tooltip.y - 32,
                        transform: 'translateX(-50%)',
                        background: 'rgba(10, 19, 34, 0.95)',
                        border: '1px solid var(--accent-cyan)',
                        borderRadius: '4px',
                        padding: '4px 8px',
                        fontSize: '10px',
                        color: '#fff',
                        fontFamily: 'var(--font-mono)',
                        pointerEvents: 'none',
                        zIndex: 10,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                    }}
                >
                    {tooltip.content}
                </div>
            )}
        </div>
    );
}
