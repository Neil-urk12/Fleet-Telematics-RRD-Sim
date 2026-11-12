import { useState } from 'react';
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { parseSimulationInputs, simulationNumericFields } from '@fleet/api-client';
import type { DrivingStyle, HvacMode, RegenLevel, RoadType, SimulationNumericDraft, SimulationNumericParameters, Vehicle } from '@fleet/api-client';

// Plain-language labels for the web form; the shared package labels stay as-is for mobile.
const FIELD_COPY: Record<keyof SimulationNumericParameters, { label: string; hint: string }> = {
    route_distance_km: { label: 'Trip distance (km)', hint: 'How far you are driving' },
    elevation_gain_m: { label: 'Total uphill (m)', hint: 'Climbing uses more battery' },
    elevation_loss_m: { label: 'Total downhill (m)', hint: 'Some energy is recovered' },
    ambient_temp_c: { label: 'Outside temperature (°C)', hint: 'Cold weather reduces range' },
    payload_kg: { label: 'Cargo & passengers (kg)', hint: 'Extra weight on board' },
    reserve_soc_target_pct: { label: 'Battery to keep on arrival (%)', hint: 'Your safety margin, 0–50' },
};

export interface RoutePreset {
    label: string;
    distanceKm: number;
    gainM: number;
    lossM: number;
    roadType: RoadType;
}

const LEVELS = ['OFF', 'LOW', 'MEDIUM', 'HIGH'] as const;
const levelLabel = (level: string) => level[0] + level.slice(1).toLowerCase();

interface ChoiceGroupProps<T extends string> {
    legend: string;
    hint: string;
    options: readonly { value: T; label: ReactNode }[];
    value: T;
    onChange: (value: T) => void;
    className?: string;
}

function ChoiceGroup<T extends string>({ legend, hint, options, value, onChange, className = '' }: ChoiceGroupProps<T>) {
    return (
        <fieldset className={`choice-group ${className}`}>
            <legend>{legend}</legend>
            <div className="choice-options">
                {options.map(option => (
                    <button
                        key={option.value}
                        type="button"
                        aria-pressed={value === option.value}
                        className={`choice-btn ${value === option.value ? 'choice-btn--active' : ''}`}
                        onClick={() => onChange(option.value)}
                    >
                        {option.label}
                    </button>
                ))}
            </div>
            <span className="route-field-hint">{hint}</span>
        </fieldset>
    );
}

type StepId = 'vehicle' | 'trip' | 'driving';

interface SetupStepProps {
    id: StepId;
    num: number;
    title: string;
    summary: ReactNode;
    open: boolean;
    onToggle: () => void;
    children: ReactNode;
}

// A step whose header toggles it; when collapsed the header shows what is currently chosen.
function SetupStep({ id, num, title, summary, open, onToggle, children }: SetupStepProps) {
    return (
        <section className={`setup-step ${open ? 'setup-step--open' : ''}`} aria-labelledby={`step-${id}`}>
            <h3 id={`step-${id}`}>
                <button type="button" className="setup-step-toggle" aria-expanded={open} aria-controls={`step-${id}-body`} onClick={onToggle}>
                    <span className="step-num" aria-hidden="true">{num}</span>
                    <span className="setup-step-title">{title}</span>
                    {!open && <span className="setup-step-summary">{summary}</span>}
                    <svg className="setup-step-chevron" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                        <path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </h3>
            <div id={`step-${id}-body`} className="setup-step-body" hidden={!open}>{children}</div>
        </section>
    );
}

const ROAD_LABEL: Record<RoadType, string> = { URBAN: 'City', HIGHWAY: 'Highway', MIXED: 'Mixed' };
const STYLE_LABEL: Record<DrivingStyle, string> = { ECO: 'Eco', NORMAL: 'Normal', AGGRESSIVE: 'Sporty' };
// Step 1 holds no numeric fields; every validated field lives in step 2.
const FIELD_STEP: StepId = 'trip';

interface RouteInputsProps {
    vehicles: Vehicle[];
    selectedVehicleId: string | null;
    onVehicleChange: (vehicleId: string) => void;
    values: SimulationNumericDraft;
    roadType: RoadType;
    presets: RoutePreset[];
    onValuesChange: (values: SimulationNumericDraft) => void;
    onRoadTypeChange: (roadType: RoadType) => void;
    drivingStyle: DrivingStyle;
    onDrivingStyleChange: (style: DrivingStyle) => void;
    hvacMode: HvacMode;
    onHvacModeChange: (mode: HvacMode) => void;
    regenLevel: RegenLevel;
    onRegenLevelChange: (regen: RegenLevel) => void;
    isSimulating: boolean;
    onSubmit: (parameters: SimulationNumericParameters & { road_type: RoadType }) => void;
}

export function RouteInputs({
    vehicles,
    selectedVehicleId,
    onVehicleChange,
    values,
    roadType,
    presets,
    onValuesChange,
    onRoadTypeChange,
    drivingStyle,
    onDrivingStyleChange,
    hvacMode,
    onHvacModeChange,
    regenLevel,
    onRegenLevelChange,
    isSimulating,
    onSubmit,
}: RouteInputsProps) {
    const [showErrors, setShowErrors] = useState(false);
    const { parameters, errors } = parseSimulationInputs(values);
    // A preset stays highlighted until the user edits one of its fields.
    const activePreset = presets.find(preset => parameters
        && preset.distanceKm === parameters.route_distance_km
        && preset.gainM === parameters.elevation_gain_m
        && preset.lossM === parameters.elevation_loss_m
        && preset.roadType === roadType)?.label ?? '';
    const [openSteps, setOpenSteps] = useState<Record<StepId, boolean>>({ vehicle: true, trip: false, driving: false });
    const toggleStep = (step: StepId) => setOpenSteps(steps => ({ ...steps, [step]: !steps[step] }));
    const selectedVehicle = vehicles.find(vehicle => vehicle.id === selectedVehicleId);
    const errorCount = showErrors ? Object.keys(errors).length : 0;

    return (
        <form
            id="route-assessment"
            className="route-inputs"
            noValidate
            onSubmit={event => {
                event.preventDefault();
                setShowErrors(true);
                if (parameters) {
                    onSubmit({ ...parameters, road_type: roadType });
                    return;
                }
                // A collapsed step's inputs are hidden and cannot take focus, so open it first.
                const form = event.currentTarget;
                flushSync(() => setOpenSteps(steps => ({ ...steps, [FIELD_STEP]: true })));
                form.querySelector<HTMLInputElement>(`[name="${Object.keys(errors)[0]}"]`)?.focus();
            }}
        >
            <div className="setup-header">
                <h2>Will this trip make it?</h2>
                <p className="route-inputs-hint">
                    Pick a vehicle and an example trip (or type your own numbers), then press Simulate trip.
                </p>
            </div>

            <div className="setup-steps">
                <SetupStep
                    id="vehicle" num={1} title="Vehicle & route"
                    open={openSteps.vehicle} onToggle={() => toggleStep('vehicle')}
                    summary={[
                        selectedVehicle ? `${selectedVehicle.id} ${selectedVehicle.model}` : 'No vehicle chosen',
                        activePreset,
                    ].filter(Boolean).join(', ')}
                >
                    <label className="route-field">
                        <span>Which vehicle?</span>
                        <select
                            value={selectedVehicleId ?? ''}
                            onChange={event => onVehicleChange(event.target.value)}
                        >
                            {vehicles.map(vehicle => (
                                <option key={vehicle.id} value={vehicle.id}>
                                    {vehicle.id} · {vehicle.model} · {Math.round(vehicle.current_soc)}% charged
                                </option>
                            ))}
                        </select>
                        <span className="route-field-hint">Also selectable from the fleet list</span>
                    </label>
                    <button
                        type="button"
                        className="garage-open-btn"
                        disabled={vehicles.length === 0}
                        onClick={() => { window.location.hash = '#/garage'; }}
                    >
                        Browse vehicles in 3D garage
                    </button>
                    <ChoiceGroup
                        legend="Start from an example trip"
                        hint="Fills distance, hills and road type. You can still edit them."
                        className="choice-group--presets"
                        options={presets.map(preset => ({
                            value: preset.label,
                            label: <>
                                <span>{preset.label}</span>
                                <small>{preset.distanceKm.toLocaleString('en-US')} km, {preset.gainM.toLocaleString('en-US')} m up</small>
                            </>,
                        }))}
                        value={activePreset}
                        onChange={label => {
                            const preset = presets.find(p => p.label === label);
                            if (!preset) return;
                            onValuesChange({
                                ...values,
                                route_distance_km: String(preset.distanceKm),
                                elevation_gain_m: String(preset.gainM),
                                elevation_loss_m: String(preset.lossM),
                            });
                            onRoadTypeChange(preset.roadType);
                        }}
                    />
                </SetupStep>

                <SetupStep
                    id="trip" num={2} title="Trip"
                    open={openSteps.trip} onToggle={() => toggleStep('trip')}
                    summary={errorCount > 0
                        ? <span className="route-field-error">{errorCount === 1 ? '1 field needs fixing' : `${errorCount} fields need fixing`}</span>
                        : `${values.route_distance_km} km, ${values.elevation_gain_m} m up, ${values.elevation_loss_m} m down, `
                            + `${values.ambient_temp_c}°C, ${values.payload_kg} kg, keep ${values.reserve_soc_target_pct}%, ${ROAD_LABEL[roadType]}`}
                >
                    <div className="route-inputs-grid">
                        {simulationNumericFields.map(field => {
                            const error = showErrors ? errors[field.key] : undefined;
                            const copy = FIELD_COPY[field.key];
                            return (
                                <label className="route-field" key={field.key}>
                                    <span>{copy.label}</span>
                                    <input
                                        type="text"
                                        inputMode={field.key === 'ambient_temp_c' ? 'text' : 'decimal'}
                                        name={field.key}
                                        value={values[field.key]}
                                        required
                                        aria-invalid={!!error}
                                        aria-describedby={error ? `${field.key}-error` : `${field.key}-hint`}
                                        onChange={event => {
                                            const value = event.target.value;
                                            onValuesChange({ ...values, [field.key]: value });
                                        }}
                                    />
                                    {error ? (
                                        <span id={`${field.key}-error`} className="route-field-error" role="alert">
                                            {error}
                                        </span>
                                    ) : (
                                        <span id={`${field.key}-hint`} className="route-field-hint">{copy.hint}</span>
                                    )}
                                </label>
                            );
                        })}
                        <label className="route-field">
                            <span>Road type</span>
                            <select value={roadType} onChange={event => onRoadTypeChange(event.target.value as RoadType)}>
                                {(Object.keys(ROAD_LABEL) as RoadType[]).map(road => (
                                    <option key={road} value={road}>{ROAD_LABEL[road]}</option>
                                ))}
                            </select>
                            <span className="route-field-hint">Mostly city, highway, or both</span>
                        </label>
                    </div>
                </SetupStep>

                <SetupStep
                    id="driving" num={3} title="Driving"
                    open={openSteps.driving} onToggle={() => toggleStep('driving')}
                    summary={`${STYLE_LABEL[drivingStyle]} driving, A/C ${hvacMode.toLowerCase()}, recovery ${regenLevel.toLowerCase()}`}
                >
                    <ChoiceGroup
                        legend="Driving style"
                        hint="Sporty driving drains the battery faster"
                        options={(Object.keys(STYLE_LABEL) as DrivingStyle[]).map(style => ({ value: style, label: STYLE_LABEL[style] }))}
                        value={drivingStyle}
                        onChange={onDrivingStyleChange}
                    />
                    <ChoiceGroup
                        legend="Heating / A/C"
                        hint="Climate control uses battery"
                        options={LEVELS.map(level => ({ value: level, label: levelLabel(level) }))}
                        value={hvacMode}
                        onChange={onHvacModeChange}
                    />
                    <ChoiceGroup
                        legend="Energy recovery when braking"
                        hint="Higher recovers more energy downhill"
                        options={LEVELS.map(level => ({ value: level, label: levelLabel(level) }))}
                        value={regenLevel}
                        onChange={onRegenLevelChange}
                    />
                </SetupStep>
            </div>

            <div className="setup-actions">
                <button
                    type="submit"
                    className="simulate-btn"
                    disabled={!selectedVehicleId || isSimulating}
                    aria-busy={isSimulating}
                    aria-describedby={selectedVehicleId ? undefined : 'simulate-needs-vehicle'}
                >
                    {isSimulating ? 'Simulating…' : 'Simulate trip'}
                </button>
                {!selectedVehicleId && <span id="simulate-needs-vehicle" className="route-field-hint">Choose a vehicle first.</span>}
            </div>
        </form>
    );
}
