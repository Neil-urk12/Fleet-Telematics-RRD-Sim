interface ControlsBarProps {
    isRunning: boolean;
    onToggleRunning: () => void;
    speed: number;
    onSpeedChange: (speed: number) => void;
    onReset: () => void;
    progressFraction: number;
    onProgressChange: (progress: number) => void;
    showAdvanced: boolean;
    onToggleAdvanced: () => void;
}

export function ControlsBar({
    isRunning,
    onToggleRunning,
    speed,
    onSpeedChange,
    onReset,
    progressFraction,
    onProgressChange,
    showAdvanced,
    onToggleAdvanced,
}: ControlsBarProps) {
    const distanceKm = (progressFraction * 129.4).toFixed(1);

    return (
        <div className="controls-bar" role="group" aria-labelledby="route-preview-title">
            <div className="preview-title">
                <h2 id="route-preview-title">Example route animation</h2>
                <span>For illustration only. Your trip result is shown above.</span>
            </div>

            {/* Playback Controls */}
            <div className="controls-group">
                <button
                    className={`ctrl-btn ctrl-btn--icon ${isRunning ? 'ctrl-btn--active' : ''}`}
                    onClick={onToggleRunning}
                    title={isRunning ? 'Pause the route preview (Space)' : 'Play the route preview (Space)'}
                >
                    {isRunning ? '⏸ Pause' : '▶ Play'}
                </button>
                <button
                    className="ctrl-btn ctrl-btn--icon"
                    onClick={onReset}
                    title="Restart the preview from Portland"
                >
                    ↺ Restart
                </button>
                {showAdvanced && <>
                    <div className="controls-divider" />
                    <span className="ctrl-label" id="preview-speed">Speed</span>
                    {[1, 2, 4, 8].map(s => (
                        <button
                            key={s}
                            aria-pressed={speed === s}
                            aria-describedby="preview-speed"
                            className={`ctrl-btn ctrl-btn--speed ${speed === s ? 'ctrl-btn--active' : ''}`}
                            onClick={() => onSpeedChange(s)}
                        >
                            {s}×
                        </button>
                    ))}
                </>}
            </div>

            {/* Speed and scrubber are demo-only detail, shown with the advanced panels. */}
            {showAdvanced && <>
            <div className="controls-divider" />

            {/* Route Scrubber */}
            <label className="controls-group" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span className="ctrl-label">Position</span>
                <input
                    type="range"
                    min={0}
                    max={100}
                    step={0.5}
                    value={Math.round(progressFraction * 100)}
                    onChange={e => onProgressChange(Number(e.target.value) / 100)}
                    className="ctrl-slider"
                    style={{ width: '100px' }}
                    aria-valuetext={`${distanceKm} km from Portland`}
                />
                <span className="ctrl-value" style={{ width: '52px', fontFamily: 'var(--font-mono)' }}>
                    {distanceKm} km
                </span>
            </label>
            </>}

            <button
                className={`ctrl-btn advanced-toggle ${showAdvanced ? 'ctrl-btn--active' : ''}`}
                aria-pressed={showAdvanced}
                onClick={onToggleAdvanced}
                title="Battery temperature, health history and regen panels"
            >
                {showAdvanced ? 'Hide advanced panels' : 'Show advanced panels'}
            </button>
        </div>
    );
}
