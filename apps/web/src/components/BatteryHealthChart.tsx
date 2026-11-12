import { useRef, useEffect, useState } from 'react';
import { formatBatteryHistory } from '@fleet/api-client';
import type { Vehicle, VehicleHistoryEntry } from '@fleet/api-client';

interface BatteryHealthChartProps {
    vehicles: Vehicle[];
    selectedVehicleId?: string | null;
    /** True while the backend has never been reached; the fixed example curves are shown instead. */
    isDemo: boolean;
    /** False while the backend is unreachable; reconnecting retries a failed history load. */
    isConnected: boolean;
    loadHistory: (vehicleId: string) => Promise<VehicleHistoryEntry[]>;
}

/** Summarize a vehicle's reported operating history for a single-line readout. */
function formatReportedHistory(vehicle: Vehicle): string {
    const parts: string[] = [];
    parts.push(vehicle.cycle_count == null ? 'cycles not reported' : `${vehicle.cycle_count} cycles`);
    parts.push(vehicle.avg_dod_pct == null ? 'DoD not reported' : `DoD ${vehicle.avg_dod_pct}%`);
    parts.push(vehicle.fast_charge_share_pct == null ? 'fast-charge not reported' : `fast-charge ${vehicle.fast_charge_share_pct}%`);
    parts.push(vehicle.thermal_stress_index == null ? 'thermal not reported' : `thermal ${vehicle.thermal_stress_index}`);
    return parts.join(' · ');
}

const MONTHS = ['MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP'];

// Fixed example curves for the offline demo fleet only.
const SOH_HISTORY: Record<string, number[]> = {
    'EV-001': [97.8, 97.5, 97.1, 96.8, 96.5, 96.3, 96.1],
    'EV-002': [94.2, 93.6, 93.1, 92.5, 92.0, 91.6, 91.3],
    'EV-003': [91.8, 91.2, 90.6, 90.0, 89.5, 89.1, 88.7],
    'EV-004': [99.1, 98.8, 98.5, 98.1, 97.8, 97.6, 97.4],
    'EV-005': [87.9, 87.1, 86.4, 85.8, 85.2, 84.7, 84.2],
    'EV-006': [96.0, 95.5, 95.1, 94.7, 94.3, 94.0, 93.8],
};

const VEHICLE_COLORS = ['#00c2ff', '#10b981', '#f59e0b', '#a78bfa', '#ef4444', '#f97316'];

interface Series {
    id: string;
    color: string;
    selected: boolean;
    /** x is a 0–1 fraction of the chart width. */
    points: { x: number; soh: number }[];
}

type HistoryResult = { vehicleId: string } & (
    | { status: 'error'; message: string }
    | { status: 'ready'; entries: VehicleHistoryEntry[] });

export function BatteryHealthChart({ vehicles, selectedVehicleId, isDemo, isConnected, loadHistory }: BatteryHealthChartProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const selectedVehicle = vehicles.find(vehicle => vehicle.id === selectedVehicleId);
    const stateTimestamp = selectedVehicle?.state_timestamp;
    // Status-only edits add a history entry without moving the battery state timestamp.
    const status = selectedVehicle?.status;
    const [result, setResult] = useState<HistoryResult | null>(null);
    // Keep this vehicle's previous line visible while it reloads; only a vehicle switch shows loading.
    const history = !isDemo && result && result.vehicleId === selectedVehicleId ? result : null;
    const entries = history?.status === 'ready' ? history.entries : null;

    useEffect(() => {
        if (isDemo || !isConnected || !selectedVehicleId) return;
        let cancelled = false;
        // shortcut: fetches the vehicle's full history on every battery update, add a backend limit or downsampling if histories grow long
        loadHistory(selectedVehicleId).then(
            loaded => {
                if (cancelled) return;
                const sorted = [...loaded].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
                setResult({ vehicleId: selectedVehicleId, status: 'ready', entries: sorted });
            },
            err => {
                if (!cancelled) setResult({
                    vehicleId: selectedVehicleId, status: 'error',
                    message: err instanceof Error ? err.message : 'Request failed',
                });
            },
        );
        return () => { cancelled = true; };
    }, [isDemo, isConnected, selectedVehicleId, stateTimestamp, status, loadHistory]);

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

        let series: Series[];
        let xLabels: { x: number; text: string }[];
        if (isDemo) {
            series = vehicles.slice(0, 6).flatMap((v, vi) => {
                const demo = SOH_HISTORY[v.id];
                return demo ? [{
                    id: v.id,
                    color: VEHICLE_COLORS[vi % VEHICLE_COLORS.length],
                    selected: v.id === selectedVehicleId,
                    points: demo.map((soh, i) => ({ x: i / (demo.length - 1), soh })),
                }] : [];
            });
            xLabels = MONTHS.map((text, i) => ({ x: i / (MONTHS.length - 1), text }));
        } else if (entries?.length && selectedVehicleId) {
            const first = Date.parse(entries[0].timestamp);
            const span = Date.parse(entries[entries.length - 1].timestamp) - first;
            series = [{
                id: selectedVehicleId,
                color: VEHICLE_COLORS[0],
                selected: true,
                // A single reading (or readings sharing one timestamp) sits at the right edge.
                points: entries.map(e => ({ x: span > 0 ? (Date.parse(e.timestamp) - first) / span : 1, soh: e.current_soh })),
            }];
            const firstDate = new Date(first);
            const lastDate = new Date(first + span);
            // Readings within one day are told apart by time of day.
            const byTime = span > 0 && firstDate.toDateString() === lastDate.toDateString();
            const label = (date: Date) => byTime
                ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : date.toLocaleDateString();
            xLabels = span > 0
                ? [{ x: 0, text: label(firstDate) }, { x: 1, text: label(lastDate) }]
                : [{ x: 1, text: label(firstDate) }];
        } else {
            return; // loading, error or empty: the notes below the chart explain
        }

        const margin = { top: 14, right: 80, bottom: 24, left: 36 };
        const chartW = W - margin.left - margin.right;
        const chartH = H - margin.top - margin.bottom;

        // Whole-percent grid steps that keep the lowest reading on the chart (demo data: 82–100%).
        const lowest = Math.min(...series.flatMap(s => s.points.map(p => p.soh)));
        const step = Math.max(1, Math.ceil((100 - lowest + 2) / 4.5));
        const maxSoh = 100;
        const minSoh = maxSoh - 4.5 * step;
        const xScale = (x: number) => margin.left + x * chartW;
        const yScale = (v: number) => margin.top + chartH - ((v - minSoh) / (maxSoh - minSoh)) * chartH;

        // 1. Grid lines + percentage labels
        [0, 1, 2, 3, 4].map(i => maxSoh - i * step).forEach(v => {
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

        // 2. Time labels
        xLabels.forEach(({ x, text }) => {
            ctx.fillStyle = '#7a8ba6';
            ctx.font = '9px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(text, xScale(x), margin.top + chartH + 15);
        });

        // 3. Warning threshold at 90%
        if (minSoh < 90) {
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
        }

        // 4. Trend lines
        series.forEach(({ id, color, selected, points }) => {
            const trace = () => points.forEach(({ x, soh }, i) => {
                if (i === 0) ctx.moveTo(xScale(x), yScale(soh)); else ctx.lineTo(xScale(x), yScale(soh));
            });

            // Selected glow
            if (selected) {
                ctx.beginPath();
                ctx.strokeStyle = '#00c2ff';
                ctx.lineWidth = 6;
                ctx.globalAlpha = 0.3;
                trace();
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            // Main line
            ctx.beginPath();
            ctx.strokeStyle = selected ? '#00c2ff' : color;
            ctx.lineWidth = selected ? 2.5 : 1.2;
            ctx.globalAlpha = selectedVehicleId ? (selected ? 1.0 : 0.45) : 0.85;
            trace();
            ctx.stroke();

            // End dot
            const last = points[points.length - 1];
            const lastX = xScale(last.x);
            const lastY = yScale(last.soh);
            ctx.beginPath();
            ctx.arc(lastX, lastY, selected ? 4 : 2.5, 0, Math.PI * 2);
            ctx.fillStyle = selected ? '#00c2ff' : color;
            ctx.fill();

            // Label
            ctx.fillStyle = selected ? '#00c2ff' : color;
            ctx.font = `${selected ? 'bold ' : ''}8px "JetBrains Mono", monospace`;
            ctx.textAlign = 'left';
            ctx.fillText(`${id} ${last.soh.toFixed(1)}%`, lastX + 6, lastY + 3);
            ctx.globalAlpha = 1.0;
        });

    }, [vehicles, selectedVehicleId, isDemo, entries]);

    const chartLabel = isDemo
        ? 'Illustrative SOH trends for the demo fleet'
        : entries?.length
            ? `${selectedVehicleId} SOH from ${entries[0].current_soh.toFixed(1)}% to ${entries[entries.length - 1].current_soh.toFixed(1)}% over ${entries.length} recorded readings`
            : 'SOH history chart, no data';

    return (
        <div className="health-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <h3 className="panel-title">
                    {isDemo ? 'DEMO SOH HISTORY — 7 MONTHS' : `SOH HISTORY · ${selectedVehicleId ?? '—'}`}
                </h3>
                <span className="panel-badge" style={{ color: isDemo ? 'var(--accent-yellow)' : 'var(--accent-green)' }}>
                    {isDemo ? 'ILLUSTRATIVE TRENDS' : 'REPORTED'}
                </span>
            </div>
            {isDemo && <p className="data-note">Fixed example history. Current SOH and reading age appear in the fleet list.</p>}
            {!isDemo && !history && (
                <p className="data-note" role="status">
                    {isConnected ? 'Loading SOH history…' : 'Reconnect to the backend to load SOH history.'}
                </p>
            )}
            {history?.status === 'error' && (
                <p className="assessment-outdated" role="alert">SOH history unavailable: {history.message}</p>
            )}
            {entries && (
                <p className="data-note" role="status">
                    {entries.length === 0 ? 'No SOH readings recorded for this vehicle yet.'
                        : entries.length === 1 ? 'Only one reading so far. A trend line appears after the next battery update.'
                            : `${entries.length} readings recorded at registration, manual battery or status edits, and telemetry.`}
                </p>
            )}
            <canvas ref={canvasRef} role="img" aria-label={chartLabel} style={{ width: '100%', flex: 1, minHeight: 0 }} />
            <p className="data-note" style={{ marginTop: 0 }}>
                {selectedVehicle
                    ? `${selectedVehicle.id} reported history: ${formatReportedHistory(selectedVehicle)} · ${formatBatteryHistory(selectedVehicle.battery_history)}`
                    : 'Select a vehicle to see its reported operating history.'}
            </p>
        </div>
    );
}
