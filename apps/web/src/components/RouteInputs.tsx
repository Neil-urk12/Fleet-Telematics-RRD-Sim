import { useState } from 'react';
import { parseSimulationInputs, simulationNumericFields } from '@fleet/api-client';
import type { RoadType, SimulationNumericDraft, SimulationNumericParameters } from '@fleet/api-client';

interface RouteInputsProps {
    initialValues: SimulationNumericDraft;
    onPayloadChange: (payload: number) => void;
    onSubmit: (parameters: SimulationNumericParameters & { road_type: RoadType }) => void;
}

export function RouteInputs({ initialValues, onPayloadChange, onSubmit }: RouteInputsProps) {
    const [values, setValues] = useState(initialValues);
    const [roadType, setRoadType] = useState<RoadType>('MIXED');
    const [showErrors, setShowErrors] = useState(false);
    const { parameters, errors } = parseSimulationInputs(values);

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
            <fieldset>
                <legend>Route assessment</legend>
                <p className="route-inputs-hint">
                    Assess the route entered here. Map playback shows the Portland–Bend demo route.
                </p>
                <div className="route-inputs-grid">
                    {simulationNumericFields.map(field => {
                        const error = showErrors ? errors[field.key] : undefined;
                        return (
                            <label className="route-field" key={field.key}>
                                <span>{field.label}</span>
                                <input
                                    type="text"
                                    inputMode={field.key === 'ambient_temp_c' ? 'text' : 'decimal'}
                                    name={field.key}
                                    value={values[field.key]}
                                    required
                                    aria-invalid={!!error}
                                    aria-describedby={error ? `${field.key}-error` : undefined}
                                    onChange={event => {
                                        const value = event.target.value;
                                        setValues(previous => ({ ...previous, [field.key]: value }));
                                        if (field.key === 'payload_kg' && value.trim() &&
                                            Number.isFinite(Number(value)) && Number(value) >= 0) {
                                            onPayloadChange(Number(value));
                                        }
                                    }}
                                />
                                {error && (
                                    <span id={`${field.key}-error`} className="route-field-error" role="alert">
                                        {error}
                                    </span>
                                )}
                            </label>
                        );
                    })}
                    <label className="route-field">
                        <span>Road type</span>
                        <select value={roadType} onChange={event => setRoadType(event.target.value as RoadType)}>
                            <option value="URBAN">Urban</option>
                            <option value="HIGHWAY">Highway</option>
                            <option value="MIXED">Mixed</option>
                        </select>
                    </label>
                </div>
            </fieldset>
        </form>
    );
}
