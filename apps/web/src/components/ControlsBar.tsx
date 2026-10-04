import type { DrivingStyle, HvacMode, RegenLevel } from '@fleet/api-client';

interface ControlsBarProps {
    isRunning: boolean;
    onToggleRunning: () => void;
    speed: number;
    onSpeedChange: (speed: number) => void;
    onReset: () => void;
    drivingStyle: DrivingStyle;
    onDrivingStyleChange: (style: DrivingStyle) => void;
    hvacMode: HvacMode;
    onHvacModeChange: (mode: HvacMode) => void;
    regenLevel: RegenLevel;
    onRegenLevelChange: (regen: RegenLevel) => void;
    progressFraction: number;
    onProgressChange: (progress: number) => void;
    selectedVehicleId: string | null;
    isSimulating?: boolean;
}

export function ControlsBar({
    isRunning,
    onToggleRunning,
    speed,
    onSpeedChange,
    onReset,
    drivingStyle,
    onDrivingStyleChange,
    hvacMode,
    onHvacModeChange,
    regenLevel,
    onRegenLevelChange,
    progressFraction,
    onProgressChange,
    selectedVehicleId,
    isSimulating = false,
}: ControlsBarProps) {
    const distanceKm = (progressFraction * 129.4).toFixed(1);

    return (
        <div className="controls-bar">
            {/* Playback Controls */}
            <div className="controls-group">
                <button
                    className={`ctrl-btn ctrl-btn--icon ${isRunning ? 'ctrl-btn--active' : ''}`}
                    onClick={onToggleRunning}
                    title={isRunning ? 'Pause simulation (Space)' : 'Resume simulation (Space)'}
                >
                    {isRunning ? '⏸ PAUSE' : '▶ PLAY'}
                </button>
                <button
                    className="ctrl-btn ctrl-btn--icon"
                    onClick={onReset}
                    title="Reset route to start"
                >
                    ↺ RESET
                </button>
                <div className="controls-divider" />
                <span className="ctrl-label">SPEED</span>
                {[1, 2, 4, 8].map(s => (
                    <button
                        key={s}
                        className={`ctrl-btn ctrl-btn--speed ${speed === s ? 'ctrl-btn--active' : ''}`}
                        onClick={() => onSpeedChange(s)}
                    >
                        {s}×
                    </button>
                ))}
            </div>

            <div className="controls-divider" />

            {/* Route Scrubber */}
            <div className="controls-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="ctrl-label">ROUTE SCRUB</span>
                <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={Math.round(progressFraction * 100)}
                    onChange={e => onProgressChange(Number(e.target.value) / 100)}
                    className="ctrl-slider"
                    style={{ width: '100px' }}
                    title={`Route Progress: ${(progressFraction * 100).toFixed(1)}%`}
                />
                <span className="ctrl-value" style={{ width: '52px', fontFamily: 'var(--font-mono)' }}>
                    {distanceKm} km
                </span>
            </div>

            <div className="controls-divider" />

            {/* Driving Parameters */}
            <div className="controls-group">
                <span className="ctrl-label">DRIVE MODE</span>
                {(['ECO', 'NORMAL', 'AGGRESSIVE'] as DrivingStyle[]).map(d => (
                    <button
                        key={d}
                        aria-label={`Driving style: ${d}`}
                        aria-pressed={drivingStyle === d}
                        className={`ctrl-btn ${drivingStyle === d ? 'ctrl-btn--active' : ''} ${
                            d === 'AGGRESSIVE' ? 'ctrl-btn--danger' : d === 'ECO' ? 'ctrl-btn--green' : ''
                        }`}
                        onClick={() => onDrivingStyleChange(d)}
                    >
                        {d}
                    </button>
                ))}
            </div>

            <div className="controls-divider" />

            {/* HVAC */}
            <div className="controls-group">
                <span className="ctrl-label">HVAC</span>
                {(['OFF', 'LOW', 'MEDIUM', 'HIGH'] as HvacMode[]).map(h => (
                    <button
                        key={h}
                        aria-label={`HVAC: ${h}`}
                        aria-pressed={hvacMode === h}
                        className={`ctrl-btn ctrl-btn--sm ${hvacMode === h ? 'ctrl-btn--active' : ''}`}
                        onClick={() => onHvacModeChange(h)}
                    >
                        {h}
                    </button>
                ))}
            </div>

            <div className="controls-divider" />

            {/* Regen */}
            <div className="controls-group">
                <span className="ctrl-label">REGEN</span>
                {(['OFF', 'LOW', 'MEDIUM', 'HIGH'] as RegenLevel[]).map(r => (
                    <button
                        key={r}
                        aria-label={`Regen: ${r}`}
                        aria-pressed={regenLevel === r}
                        className={`ctrl-btn ctrl-btn--sm ${regenLevel === r ? 'ctrl-btn--active' : ''}`}
                        onClick={() => onRegenLevelChange(r)}
                    >
                        {r}
                    </button>
                ))}
            </div>

            <div className="controls-divider" />

            {/* Run simulation button */}
            <div className="controls-group" style={{ marginLeft: 'auto' }}>
                <button
                    type="submit"
                    form="route-assessment"
                    className={`ctrl-btn ctrl-btn--run ${isSimulating ? 'ctrl-btn--running' : ''}`}
                    disabled={!selectedVehicleId || isSimulating}
                    title={
                        selectedVehicleId
                            ? `Assess the entered route for ${selectedVehicleId}`
                            : 'Select a vehicle in the fleet list first'
                    }
                >
                    {isSimulating ? '⏳ COMPUTING...' : '⚡ RUN SIM'}
                </button>
            </div>
        </div>
    );
}
