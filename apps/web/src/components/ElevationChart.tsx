import { useRef, useEffect, useState, useMemo } from 'react';

interface ElevationPoint {
    [key: string]: number;
    distance: number;
    elevation: number;
}

interface SocPoint {
    [key: string]: number;
    distance: number;
    soc: number;
}

interface ElevationChartProps {
    elevationData: ElevationPoint[];
    socData: SocPoint[];
    totalDistance: number;
    progressFraction?: number; // 0 to 1
}

// Interpolate value at arbitrary distance along data points
function interpolateAtDistance(data: Array<{ distance: number; [key: string]: number }>, key: string, targetDist: number): number {
    if (data.length === 0) return 0;
    if (targetDist <= data[0].distance) return data[0][key];
    if (targetDist >= data[data.length - 1].distance) return data[data.length - 1][key];

    for (let i = 0; i < data.length - 1; i++) {
        const p1 = data[i];
        const p2 = data[i + 1];
        if (targetDist >= p1.distance && targetDist <= p2.distance) {
            const range = p2.distance - p1.distance;
            const fraction = range > 0 ? (targetDist - p1.distance) / range : 0;
            return p1[key] + (p2[key] - p1[key]) * fraction;
        }
    }
    return data[data.length - 1][key];
}

export function ElevationChart({
    elevationData,
    socData,
    totalDistance,
    progressFraction = 0.5,
}: ElevationChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [hoverPoint, setHoverPoint] = useState<{
        dist: number;
        elev: number;
        soc: number;
        x: number;
        y: number;
    } | null>(null);

    const currentDist = progressFraction * totalDistance;
    const currentElevation = useMemo(
        () => interpolateAtDistance(elevationData, 'elevation', currentDist),
        [elevationData, currentDist]
    );
    const currentSoc = useMemo(
        () => interpolateAtDistance(socData, 'soc', currentDist),
        [socData, currentDist]
    );

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
        const margin = { top: 26, right: 20, bottom: 28, left: 44 };
        const chartW = W - margin.left - margin.right;
        const chartH = H - margin.top - margin.bottom;

        ctx.clearRect(0, 0, W, H);

        const maxElev = Math.max(...elevationData.map(d => d.elevation), 1600);

        const xScale = (d: number) => (d / totalDistance) * chartW + margin.left;
        const yScaleElev = (e: number) => margin.top + chartH - (e / maxElev) * chartH;
        const yScaleSoc  = (s: number) => margin.top + chartH - (s / 100) * chartH;

        // 1. Grid lines & SOC percentage labels
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(30, 45, 61, 0.9)';
        ctx.lineWidth = 1;
        [0, 25, 50, 75, 100].forEach(pct => {
            const y = yScaleSoc(pct);
            ctx.beginPath();
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + chartW, y);
            ctx.stroke();
        });
        ctx.setLineDash([]);

        // 2. Elevation Mountain Profile (filled area)
        ctx.beginPath();
        ctx.moveTo(xScale(elevationData[0].distance), yScaleElev(elevationData[0].elevation));
        for (const p of elevationData) {
            ctx.lineTo(xScale(p.distance), yScaleElev(p.elevation));
        }
        ctx.lineTo(xScale(elevationData[elevationData.length - 1].distance), margin.top + chartH);
        ctx.lineTo(margin.left, margin.top + chartH);
        ctx.closePath();

        const elevGrad = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartH);
        elevGrad.addColorStop(0, 'rgba(71, 85, 105, 0.5)');
        elevGrad.addColorStop(1, 'rgba(30, 41, 59, 0.05)');
        ctx.fillStyle = elevGrad;
        ctx.fill();

        // Elevation outline line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < elevationData.length; i++) {
            const x = xScale(elevationData[i].distance);
            const y = yScaleElev(elevationData[i].elevation);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // 3. Peak summit label (Government Camp ~1490m)
        const peakPoint = elevationData.reduce((prev, curr) => curr.elevation > prev.elevation ? curr : prev, elevationData[0]);
        const peakX = xScale(peakPoint.distance);
        const peakY = yScaleElev(peakPoint.elevation);
        ctx.fillStyle = 'rgba(244, 114, 182, 0.8)';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`▲ SUMMIT ${peakPoint.elevation}m`, peakX, peakY - 6);

        // 4. Battery SOC Area Fill
        const socGrad = ctx.createLinearGradient(0, margin.top, 0, margin.top + chartH);
        socGrad.addColorStop(0, 'rgba(0, 194, 255, 0.22)');
        socGrad.addColorStop(1, 'rgba(0, 194, 255, 0.01)');

        ctx.beginPath();
        for (let i = 0; i < socData.length; i++) {
            const x = xScale(socData[i].distance);
            const y = yScaleSoc(socData[i].soc);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineTo(xScale(socData[socData.length - 1].distance), margin.top + chartH);
        ctx.lineTo(margin.left, margin.top + chartH);
        ctx.closePath();
        ctx.fillStyle = socGrad;
        ctx.fill();

        // 5. Battery SOC Line with glow
        ctx.beginPath();
        ctx.strokeStyle = '#00c2ff';
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(0, 194, 255, 0.6)';
        ctx.shadowBlur = 8;
        for (let i = 0; i < socData.length; i++) {
            const x = xScale(socData[i].distance);
            const y = yScaleSoc(socData[i].soc);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // 6. Live Vehicle Position Tracking Cursor
        const curX = xScale(currentDist);
        const curElevY = yScaleElev(currentElevation);
        const curSocY = yScaleSoc(currentSoc);

        // Vertical tracking laser
        ctx.beginPath();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = '#00c2ff';
        ctx.lineWidth = 1.5;
        ctx.moveTo(curX, margin.top);
        ctx.lineTo(curX, margin.top + chartH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dot at elevation curve
        ctx.beginPath();
        ctx.arc(curX, curElevY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#cbd5e1';
        ctx.fill();

        // Dot at SOC curve (with glow ring)
        ctx.beginPath();
        ctx.arc(curX, curSocY, 8, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 194, 255, 0.25)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(curX, curSocY, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#00c2ff';
        ctx.fill();

        // 7. Hover inspection crosshair
        if (hoverPoint) {
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.moveTo(hoverPoint.x, margin.top);
            ctx.lineTo(hoverPoint.x, margin.top + chartH);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // 8. Distance Axis Labels (bottom)
        ctx.fillStyle = '#4a5568';
        ctx.font = '9px Inter, sans-serif';
        ctx.textAlign = 'center';
        for (let d = 0; d <= totalDistance; d += 25) {
            ctx.fillText(`${d}km`, xScale(d), margin.top + chartH + 18);
        }

        // 9. Y-Axis Labels (left: SOC %, right: Elevation m)
        ctx.textAlign = 'right';
        [0, 25, 50, 75, 100].forEach(pct => {
            ctx.fillStyle = pct <= 25 ? '#ef4444' : pct <= 50 ? '#f59e0b' : '#00c2ff';
            ctx.fillText(`${pct}%`, margin.left - 5, yScaleSoc(pct) + 3);
        });

        // 10. Legend
        ctx.textAlign = 'left';
        ctx.fillStyle = '#00c2ff';
        ctx.font = 'bold 9px Inter, sans-serif';
        ctx.fillText('─── SOC %', margin.left + 4, margin.top - 10);
        ctx.fillStyle = 'rgba(148, 163, 184, 0.9)';
        ctx.fillText('  ▬  Elevation Profile', margin.left + 65, margin.top - 10);
        ctx.fillStyle = '#10b981';
        ctx.fillText(`  ● Demo Pos: ${currentDist.toFixed(1)} km`, margin.left + 175, margin.top - 10);

    }, [elevationData, socData, totalDistance, progressFraction, currentDist, currentElevation, currentSoc, hoverPoint]);

    const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const marginL = 44;
        const marginR = 20;
        const chartW = rect.width - marginL - marginR;

        if (mouseX < marginL || mouseX > marginL + chartW) {
            setHoverPoint(null);
            return;
        }

        const distRatio = Math.max(0, Math.min(1, (mouseX - marginL) / chartW));
        const dist = distRatio * totalDistance;
        const elev = interpolateAtDistance(elevationData, 'elevation', dist);
        const soc = interpolateAtDistance(socData, 'soc', dist);

        setHoverPoint({
            dist,
            elev,
            soc,
            x: mouseX,
            y: e.clientY - rect.top,
        });
    };

    const handleMouseLeave = () => {
        setHoverPoint(null);
    };

    return (
        <div className="elevation-panel" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div className="panel-header">
                <h3 className="panel-title">DEMO ELEVATION &amp; LOCAL SOC ESTIMATE</h3>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <span className="panel-badge" style={{ color: 'var(--accent-cyan)' }}>
                        ALT: {Math.round(currentElevation)} m
                    </span>
                    <span className="panel-badge" style={{ color: currentSoc > 30 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                        SOC: {currentSoc.toFixed(1)}%
                    </span>
                </div>
            </div>

            <p className="assessment-note">Portland–Bend illustration · Separate from the backend route assessment.</p>

            <canvas
                ref={canvasRef}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                style={{ width: '100%', flex: 1, minHeight: 0, cursor: 'crosshair' }}
            />

            {hoverPoint && (
                <div
                    style={{
                        position: 'absolute',
                        left: Math.min(hoverPoint.x + 12, 280),
                        top: 40,
                        background: 'rgba(11, 17, 32, 0.95)',
                        border: '1px solid var(--accent-cyan)',
                        borderRadius: '4px',
                        padding: '6px 10px',
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        color: '#fff',
                        pointerEvents: 'none',
                        zIndex: 10,
                        boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                    }}
                >
                    <div style={{ color: 'var(--accent-cyan)', fontWeight: 'bold' }}>
                        📍 {hoverPoint.dist.toFixed(1)} km
                    </div>
                    <div>Elevation: {Math.round(hoverPoint.elev)} m</div>
                    <div>Projected SOC: {hoverPoint.soc.toFixed(1)}%</div>
                </div>
            )}
        </div>
    );
}
