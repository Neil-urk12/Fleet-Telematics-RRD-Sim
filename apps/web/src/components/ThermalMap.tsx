import { useState } from 'react';

interface ThermalMapProps {
    cellTemps: number[][];
    maxTemp: number;
    avgTemp: number;
    packHealthPct?: number;
    readingLabel: string;
}

export function ThermalMap({ cellTemps, maxTemp, avgTemp, readingLabel }: ThermalMapProps) {
    const [hoveredCell, setHoveredCell] = useState<{ row: number; col: number; temp: number } | null>(null);
    const hotspot = findHotspot(cellTemps);
    const minTemp = Math.min(...cellTemps.flat());
    const tempSpread = maxTemp - minTemp;

    const thermalStatus = maxTemp > 45 ? 'CRITICAL' : maxTemp > 40 ? 'WARNING' : 'NOMINAL';
    const statusColor = maxTemp > 45
        ? 'var(--accent-red)'
        : maxTemp > 40
        ? 'var(--accent-yellow)'
        : 'var(--accent-green)';

    return (
        <div className="thermal-panel" style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div className="panel-header">
                <h3 className="panel-title">ILLUSTRATIVE PACK THERMAL GRID</h3>
                <span className="panel-badge" style={{ color: statusColor }}>
                    ● {thermalStatus}
                </span>
            </div>
            <p className="data-note">{readingLabel}. Module temperatures and thermal status are local estimates.</p>

            {/* Thermal Grid of Battery Pack Modules (4 x 6) */}
            <div
                className="thermal-grid"
                style={{
                    gridTemplateColumns: `repeat(${cellTemps[0]?.length || 6}, 1fr)`,
                    flex: 1,
                    minHeight: 0,
                    gap: '3px',
                }}
            >
                {cellTemps.flatMap((row, r) =>
                    row.map((temp, c) => {
                        const isHot = r === hotspot.row && c === hotspot.col;
                        return (
                            <div
                                key={`${r}-${c}`}
                                className={`thermal-cell${isHot ? ' thermal-cell--hot' : ''}`}
                                style={{
                                    backgroundColor: tempToColor(temp, minTemp, maxTemp),
                                    transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                                }}
                                onMouseEnter={() => setHoveredCell({ row: r, col: c, temp })}
                                onMouseLeave={() => setHoveredCell(null)}
                            >
                                <span className="thermal-cell-value">{temp.toFixed(0)}°</span>
                                {isHot && <span style={{ fontSize: '7px', color: '#ffdddd' }}>HOT</span>}
                            </div>
                        );
                    })
                )}
            </div>

            {/* Hover Tooltip */}
            {hoveredCell && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '50px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        background: 'rgba(11, 19, 32, 0.95)',
                        border: '1px solid var(--accent-cyan)',
                        borderRadius: '4px',
                        padding: '4px 10px',
                        fontSize: '10px',
                        fontFamily: 'var(--font-mono)',
                        color: '#fff',
                        zIndex: 10,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
                    }}
                >
                    Module [{hoveredCell.row + 1},{hoveredCell.col + 1}]: <strong>{hoveredCell.temp.toFixed(1)}°C</strong> ({(hoveredCell.temp - avgTemp >= 0 ? '+' : '') + (hoveredCell.temp - avgTemp).toFixed(1)}° vs avg)
                </div>
            )}

            {/* Color Ramp Legend */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '4px 0', padding: '0 2px' }}>
                <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{minTemp.toFixed(0)}°C</span>
                <div
                    style={{
                        flex: 1,
                        height: '4px',
                        borderRadius: '2px',
                        background: 'linear-gradient(to right, hsl(200, 65%, 40%), hsl(120, 75%, 45%), hsl(60, 85%, 50%), hsl(0, 90%, 55%))',
                    }}
                />
                <span style={{ fontSize: '8px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{maxTemp.toFixed(0)}°C</span>
            </div>

            {/* Thermal Stats Bar */}
            <div className="thermal-stats" style={{ paddingTop: '4px' }}>
                <div>
                    <span className="stat-label">MAX TEMP</span>
                    <span className="stat-value" style={{ color: maxTemp > 40 ? 'var(--accent-red)' : 'var(--text-primary)', fontSize: '12px' }}>
                        {maxTemp.toFixed(1)}°C
                    </span>
                </div>
                <div>
                    <span className="stat-label">HOTSPOT</span>
                    <span className="stat-value" style={{ fontSize: '12px', color: 'var(--accent-yellow)' }}>
                        M[{hotspot.row + 1},{hotspot.col + 1}]
                    </span>
                </div>
                <div>
                    <span className="stat-label">AVG TEMP</span>
                    <span className="stat-value" style={{ fontSize: '12px' }}>
                        {avgTemp.toFixed(1)}°C
                    </span>
                </div>
                <div>
                    <span className="stat-label">SPREAD (ΔT)</span>
                    <span className="stat-value" style={{ color: tempSpread > 8 ? 'var(--accent-red)' : 'var(--accent-cyan)', fontSize: '12px' }}>
                        {tempSpread.toFixed(1)}°C
                    </span>
                </div>
            </div>
        </div>
    );
}

function tempToColor(temp: number, min: number, max: number): string {
    const range = Math.max(max - min, 1);
    const ratio = Math.max(0, Math.min(1, (temp - min) / range));
    // Cool cyan/blue (200°) → emerald green (130°) → amber/yellow (55°) → red (0°)
    const hue = 200 * (1 - ratio);
    const saturation = 65 + ratio * 25;
    const lightness  = 38 + ratio * 16;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

function findHotspot(grid: number[][]): { row: number; col: number; temp: number } {
    let best = { row: 0, col: 0, temp: -Infinity };
    grid.forEach((row, r) =>
        row.forEach((temp, c) => {
            if (temp > best.temp) best = { row: r, col: c, temp };
        })
    );
    return best;
}
