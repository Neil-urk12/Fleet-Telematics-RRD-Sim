import { useRef, useEffect } from 'react';
import type { Vehicle } from '@fleet/api-client';

interface BatteryHealthChartProps {
    vehicles: Vehicle[];
    selectedVehicleId?: string | null;
}

const MONTHS = ['MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP'];

// Stable per-vehicle SOH history
const SOH_HISTORY: Record<string, number[]> = {
    'EV-001': [97.8, 97.5, 97.1, 96.8, 96.5, 96.3, 96.1],
    'EV-002': [94.2, 93.6, 93.1, 92.5, 92.0, 91.6, 91.3],
    'EV-003': [91.8, 91.2, 90.6, 90.0, 89.5, 89.1, 88.7],
    'EV-004': [99.1, 98.8, 98.5, 98.1, 97.8, 97.6, 97.4],
    'EV-005': [87.9, 87.1, 86.4, 85.8, 85.2, 84.7, 84.2],
    'EV-006': [96.0, 95.5, 95.1, 94.7, 94.3, 94.0, 93.8],
};

const VEHICLE_COLORS = ['#00c2ff', '#10b981', '#f59e0b', '#a78bfa', '#ef4444', '#f97316'];

export function BatteryHealthChart({ vehicles, selectedVehicleId }: BatteryHealthChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

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

        const margin = { top: 14, right: 80, bottom: 24, left: 36 };
        const chartW = W - margin.left - margin.right;
        const chartH = H - margin.top - margin.bottom;

        const minSoh = 82;
        const maxSoh = 100;
        const xScale = (i: number) => margin.left + (i / (MONTHS.length - 1)) * chartW;
        const yScale = (v: number) => margin.top + chartH - ((v - minSoh) / (maxSoh - minSoh)) * chartH;

        // 1. Grid lines + percentage labels
        [84, 88, 92, 96, 100].forEach(v => {
            const y = yScale(v);
            ctx.beginPath();
            ctx.strokeStyle = 'rgba(30, 45, 61, 0.9)';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            ctx.moveTo(margin.left, y);
            ctx.lineTo(margin.left + chartW, y);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = '#4a5568';
            ctx.font = '8px Inter, sans-serif';
            ctx.textAlign = 'right';
            ctx.fillText(`${v}%`, margin.left - 4, y + 3);
        });

        // 2. Month labels
        MONTHS.forEach((m, i) => {
            ctx.fillStyle = '#7a8ba6';
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(m, xScale(i), margin.top + chartH + 15);
        });

        // 3. Warning threshold at 90%
        const warnY = yScale(90);
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.4)';
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 3]);
        ctx.moveTo(margin.left, warnY);
        ctx.lineTo(margin.left + chartW, warnY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(245, 158, 11, 0.7)';
        ctx.font = '8px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('90% SOH THRESHOLD', margin.left + 4, warnY - 3);

        // 4. Vehicle trend lines
        vehicles.slice(0, 6).forEach((v, vi) => {
            const history = SOH_HISTORY[v.id];
            if (!history) return;
            const isSelected = v.id === selectedVehicleId;
            const color = VEHICLE_COLORS[vi % VEHICLE_COLORS.length];

            // Selected glow
            if (isSelected) {
                ctx.beginPath();
                ctx.strokeStyle = '#00c2ff';
                ctx.lineWidth = 6;
                ctx.globalAlpha = 0.3;
                history.forEach((soh, i) => {
                    const x = xScale(i), y = yScale(soh);
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Main line
            ctx.beginPath();
            ctx.strokeStyle = isSelected ? '#00c2ff' : color;
            ctx.lineWidth = isSelected ? 2.5 : 1.2;
            ctx.globalAlpha = selectedVehicleId ? (isSelected ? 1.0 : 0.45) : 0.85;
            history.forEach((soh, i) => {
                const x = xScale(i), y = yScale(soh);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();

            // End dot
            const lastX = xScale(history.length - 1);
            const lastY = yScale(history[history.length - 1]);
            ctx.beginPath();
            ctx.arc(lastX, lastY, isSelected ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = isSelected ? '#00c2ff' : color;
            ctx.fill();

            // Label
            ctx.fillStyle = isSelected ? '#00c2ff' : color;
            ctx.font = `${isSelected ? 'bold ' : ''}8px "JetBrains Mono", monospace`;
            ctx.textAlign = 'left';
            ctx.fillText(`${v.id} ${history[history.length - 1].toFixed(1)}%`, lastX + 6, lastY + 3);
            ctx.globalAlpha = 1.0;
        });

    }, [vehicles, selectedVehicleId]);

    return (
        <div className="health-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <h3 className="panel-title">DEMO SOH HISTORY — 7 MONTHS</h3>
                <span className="panel-badge" style={{ color: 'var(--accent-yellow)' }}>
                    ILLUSTRATIVE TRENDS
                </span>
            </div>
            <p className="data-note">Fixed example history. Current SOH and reading age appear in the fleet list.</p>
            <canvas ref={canvasRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />
        </div>
    );
}
