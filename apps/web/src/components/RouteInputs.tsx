import { useState } from 'react';
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
    options: readonly { value: T; label: string }[];
    value: T;
    onChange: (value: T) => void;
}

function ChoiceGroup<T extends string>({ legend, hint, options, value, onChange }: ChoiceGroupProps<T>) {
    return (
        <fieldset className="choice-group">
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

    return (
        <form
            id="route-assessment"
            className="route-inputs"
            noValidate
            onSubmit={event => {
                event.preventDefault();
                setShowErrors(true);
                if (parameters) onSubmit({ ...parameters, road_type: roadType });
                else event.currentTarget.querySelector<HTMLInputElement>(
                    `[name="${Object.keys(errors)[0]}"]`
                )?.focus();
            }}
        >
            <div className="setup-header">
                <h2>Will this trip make it?</h2>
                <p className="route-inputs-hint">
                    Pick a vehicle and an example trip (or type your own numbers), then press Simulate trip.
                </p>
            </div>

            <div className="setup-steps">
                <section className="setup-step" aria-labelledby="step-vehicle">
                    <h3 id="step-vehicle"><span className="step-num" aria-hidden="true">1</span>Vehicle & route</h3>
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
                    <ChoiceGroup
                        legend="Start from an example trip"
                        hint="Fills distance, hills and road type. You can still edit them."
                        options={presets.map(preset => ({ value: preset.label, label: preset.label }))}
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
                </section>

                <section className="setup-step" aria-labelledby="step-trip">
                    <h3 id="step-trip"><span className="step-num" aria-hidden="true">2</span>Trip</h3>
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
                                <option value="URBAN">City</option>
                                <option value="HIGHWAY">Highway</option>
                                <option value="MIXED">Mixed</option>
                            </select>
                            <span className="route-field-hint">Mostly city, highway, or both</span>
                        </label>
                    </div>
                </section>

                <section className="setup-step" aria-labelledby="step-driving">
                    <h3 id="step-driving"><span className="step-num" aria-hidden="true">3</span>Driving</h3>
                    <ChoiceGroup
                        legend="Driving style"
                        hint="Sporty driving drains the battery faster"
                        options={[
                            { value: 'ECO', label: 'Eco' },
                            { value: 'NORMAL', label: 'Normal' },
                            { value: 'AGGRESSIVE', label: 'Sporty' },
                        ]}
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
                </section>
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
