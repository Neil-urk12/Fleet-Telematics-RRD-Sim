import { useRef, useEffect, useMemo } from 'react';

interface RegenBrakingPanelProps {
    vehicles: Array<{ id: string }>;
    selectedVehicleId?: string | null;
    regenLevel?: string;
}

const BASE_REGEN_SEED: Record<string, { regenKwh: number; brakeKwh: number }> = {
    'EV-001': { regenKwh: 8.4, brakeKwh: 1.8 },
    'EV-002': { regenKwh: 6.2, brakeKwh: 2.9 },
    'EV-003': { regenKwh: 4.1, brakeKwh: 3.7 },
    'EV-004': { regenKwh: 9.1, brakeKwh: 1.2 },
    'EV-005': { regenKwh: 2.3, brakeKwh: 4.5 },
    'EV-006': { regenKwh: 7.6, brakeKwh: 2.1 },
};

export function RegenBrakingPanel({
    vehicles,
    selectedVehicleId,
    regenLevel = 'MEDIUM',
}: RegenBrakingPanelProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Multiplier based on regen setting
    const regenMultiplier = regenLevel === 'OFF' ? 0.05 : regenLevel === 'LOW' ? 0.6 : regenLevel === 'HIGH' ? 1.35 : 1.0;

    const data = useMemo(() =>
        vehicles.map(v => {
            const base = BASE_REGEN_SEED[v.id] ?? { regenKwh: 5, brakeKwh: 2 };
            return {
                id: v.id,
                regenKwh: base.regenKwh * regenMultiplier,
                brakeKwh: base.brakeKwh * (1 / regenMultiplier),
            };
        }),
        [vehicles, regenMultiplier]
    );

    const totalRegen = data.reduce((s, d) => s + d.regenKwh, 0);
    const totalBrake = data.reduce((s, d) => s + d.brakeKwh, 0);
    const efficiency = (totalRegen / (totalRegen + totalBrake || 1)) * 100;

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

        const marginL = 54;
        const marginR = 76;
        const marginT = 4;
        const slotH = Math.max(12, (H - marginT) / data.length - 6);
        const chartW = W - marginL - marginR;
        const maxVal = Math.max(...data.map(d => d.regenKwh + d.brakeKwh), 12);

        data.forEach((d, i) => {
            const y = marginT + i * (slotH + 6);
            const isSelected = d.id === selectedVehicleId;

            // Vehicle ID label
            ctx.fillStyle = isSelected ? '#00c2ff' : '#7a8ba6';
            ctx.font = `${isSelected ? 'bold ' : ''}9px "JetBrains Mono", monospace`;
            ctx.textAlign = 'right';
            ctx.fillText(d.id, marginL - 6, y + slotH * 0.65);

            // Selected row highlight background
            if (isSelected) {
                ctx.fillStyle = 'rgba(0, 194, 255, 0.08)';
                ctx.fillRect(marginL - 4, y - 2, chartW + marginR, slotH + 4);
            }

            // Regen bar (emerald gradient)
            const regenW = Math.max(2, (d.regenKwh / maxVal) * chartW);
            const gy = ctx.createLinearGradient(marginL, 0, marginL + regenW, 0);
            gy.addColorStop(0, '#065f46');
            gy.addColorStop(1, isSelected ? '#34d399' : '#10b981');
            ctx.fillStyle = gy;
            const barH = slotH * 0.55;
            ctx.beginPath();
            ctx.roundRect(marginL, y, regenW, barH, 2);
            ctx.fill();

            // Friction brake loss bar (crimson)
            const brakeW = Math.max(2, (d.brakeKwh / maxVal) * chartW);
            ctx.fillStyle = 'rgba(239, 68, 68, 0.5)';
            const brakeH = slotH * 0.3;
            ctx.beginPath();
            ctx.roundRect(marginL, y + barH + 2, brakeW, brakeH, 2);
            ctx.fill();

            // Value label
            ctx.fillStyle = isSelected ? '#34d399' : '#10b981';
            ctx.font = 'bold 9px "JetBrains Mono", monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`+${d.regenKwh.toFixed(1)} kWh`, marginL + regenW + 5, y + barH * 0.8);
        });

    }, [data, selectedVehicleId]);

    return (
        <div className="regen-panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <h3 className="panel-title">DEMO REGEN &amp; BRAKING ESTIMATE</h3>
                <span className="panel-badge" style={{ color: 'var(--accent-green)' }}>
                    ● {efficiency.toFixed(0)}% CAPTURE ({regenLevel})
                </span>
            </div>
            <p className="data-note">Illustrative values based on the regen setting. Fleet recovery and brake losses are not measured.</p>

            <div className="regen-stats-row">
                <div className="regen-stat">
                    <span className="stat-label">EXAMPLE RECOVERY</span>
                    <span className="stat-value" style={{ color: 'var(--accent-green)', fontSize: '13px' }}>
                        +{totalRegen.toFixed(1)} kWh
                    </span>
                </div>
                <div className="regen-stat">
                    <span className="stat-label">EXAMPLE BRAKE LOSS</span>
                    <span className="stat-value" style={{ color: 'var(--accent-red)', fontSize: '13px' }}>
                        -{totalBrake.toFixed(1)} kWh
                    </span>
                </div>
                <div className="regen-stat">
                    <span className="stat-label">EXAMPLE RANGE BOOST</span>
                    <span className="stat-value" style={{ color: 'var(--accent-cyan)', fontSize: '13px' }}>
                        +{(totalRegen * 5.8).toFixed(0)} km
                    </span>
                </div>
            </div>

            <canvas ref={canvasRef} style={{ width: '100%', flex: 1, minHeight: 0 }} />

            <div className="regen-legend">
                <span className="regen-legend-item regen-legend-item--green">■ Kinetic Harvest (Regen)</span>
                <span className="regen-legend-item regen-legend-item--red">■ Thermal Loss (Pads)</span>
            </div>
        </div>
    );
}
