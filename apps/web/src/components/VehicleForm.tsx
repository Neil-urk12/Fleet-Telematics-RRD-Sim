import { useState } from 'react';
import type { SubmitEvent } from 'react';
import type { Vehicle, VehicleCreate, VehicleUpdate } from '@fleet/api-client';
import { formatEvSpecs } from '../evModels';
import type { EvModel } from '../evModels';

const TEXT_FIELDS = [
    { key: 'id', label: 'Vehicle ID', hint: 'Unique, e.g. EV-101' },
    { key: 'name', label: 'Name', hint: 'Display name, e.g. Delivery van 1' },
    { key: 'model', label: 'Make & model', hint: 'e.g. Tesla Model 3' },
] as const;

const NUMBER_FIELDS = [
    { key: 'battery_capacity_kwh', label: 'Battery capacity (kWh)', hint: 'Usable pack size, e.g. 75', min: 0, max: Infinity, minInclusive: false },
    { key: 'baseline_efficiency_wh_km', label: 'Efficiency (Wh/km)', hint: 'Typical use, e.g. 160', min: 0, max: Infinity, minInclusive: false },
    { key: 'current_soc', label: 'Current charge (%)', hint: 'State of charge, 0–100', min: 0, max: 100, minInclusive: true },
    { key: 'current_soh', label: 'Battery health (%)', hint: 'State of health, 0–100', min: 0, max: 100, minInclusive: true },
    { key: 'curb_mass_kg', label: 'Curb mass (kg)', hint: 'Unloaded weight', min: 0, max: Infinity, minInclusive: false },
    { key: 'regen_efficiency', label: 'Regen efficiency (0–1)', hint: 'Share of downhill energy recovered', min: 0, max: 1, minInclusive: true },
] as const;

const STATUSES = ['AVAILABLE', 'IN_USE', 'CHARGING', 'MAINTENANCE'];

// Add mode: filled from the model picked in the garage (regen keeps its default), so hidden.
const CATALOG_KEYS: string[] = ['model', 'battery_capacity_kwh', 'baseline_efficiency_wh_km', 'curb_mass_kg', 'regen_efficiency'];

type NumberKey = typeof NUMBER_FIELDS[number]['key'];
type FieldKey = typeof TEXT_FIELDS[number]['key'] | NumberKey;
type Draft = Record<FieldKey, string>;

const EMPTY_DRAFT: Draft = {
    id: '', name: '', model: '',
    battery_capacity_kwh: '', baseline_efficiency_wh_km: '',
    current_soc: '80', current_soh: '100', curb_mass_kg: '2500', regen_efficiency: '0.6',
};

// curb_mass_kg and regen_efficiency are optional in the shared type; the backend fills defaults.
const numberOf = (v: Vehicle, key: NumberKey) => v[key] ?? Number(EMPTY_DRAFT[key]);

const draftFrom = (v: Vehicle): Draft => ({
    id: v.id, name: v.name, model: v.model,
    ...Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, String(numberOf(v, key))])) as Record<NumberKey, string>,
});

function validateVehicleDraft(draft: Draft, takenIds: string[]): Partial<Record<FieldKey, string>> {
    const errors: Partial<Record<FieldKey, string>> = {};
    for (const { key, label } of TEXT_FIELDS) {
        if (!draft[key].trim()) errors[key] = `${label} is required.`;
    }
    if (!errors.id && takenIds.includes(draft.id.trim())) errors.id = 'A vehicle with this ID already exists.';
    for (const { key, min, max, minInclusive } of NUMBER_FIELDS) {
        const raw = draft[key].trim();
        const value = Number(raw);
        if (!raw || !Number.isFinite(value)) errors[key] = 'Enter a number.';
        else if (minInclusive ? value < min : value <= min) errors[key] = minInclusive ? `Must be at least ${min}.` : `Must be greater than ${min}.`;
        else if (value > max) errors[key] = `Must be at most ${max}.`;
    }
    return errors;
}

interface VehicleFormProps {
    vehicles: Vehicle[];
    canSubmit: boolean;
    /** The vehicle being edited (render with `key={editing?.id}` so the form resets per vehicle). */
    editing: Vehicle | null;
    /** Add mode: the known EV picked in the garage; it supplies the model and specs. */
    spec?: EvModel | null;
    /** Add mode (in the garage) needs onCreate; edit mode needs onUpdate and onStopEditing. */
    onCreate?: (payload: VehicleCreate) => Promise<Vehicle>;
    onUpdate?: (vehicleId: string, payload: VehicleUpdate) => Promise<Vehicle>;
    onCreated?: (vehicle: Vehicle) => void;
    onStopEditing?: () => void;
}

export function VehicleForm({ vehicles, canSubmit, editing, spec, onCreate, onUpdate, onCreated, onStopEditing }: VehicleFormProps) {
    // Edits are compared with the vehicle as it was when editing began, so telemetry
    // arriving meanwhile is never overwritten by fields the user did not touch.
    const [baseline, setBaseline] = useState(editing);
    const [draft, setDraft] = useState<Draft>(editing ? draftFrom(editing) : EMPTY_DRAFT);
    const [status, setStatus] = useState(editing?.status ?? 'AVAILABLE');
    const [showErrors, setShowErrors] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    // Without a picked model the hidden spec fields stay blank and fail validation with it.
    const values: Draft = !baseline && spec
        ? { ...draft, ...Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, String(v)])) }
        : draft;
    const errors = validateVehicleDraft(values, vehicles.map(v => v.id).filter(id => id !== baseline?.id));

    const changes = (base: Vehicle): VehicleUpdate => {
        const update: VehicleUpdate & Record<string, unknown> = {};
        if (draft.name.trim() !== base.name) update.name = draft.name.trim();
        if (draft.model.trim() !== base.model) update.model = draft.model.trim();
        for (const { key } of NUMBER_FIELDS) {
            if (Number(draft[key]) !== numberOf(base, key)) update[key] = Number(draft[key]);
        }
        if (status !== base.status) update.status = status;
        return update;
    };

    const handleSubmit = async (event: SubmitEvent<HTMLFormElement>) => {
        event.preventDefault();
        setShowErrors(true);
        setMessage(null);
        if (Object.keys(errors).length > 0 || submitting || !canSubmit) return;
        const update = baseline && changes(baseline);
        if (update && Object.keys(update).length === 0) {
            setMessage({ kind: 'ok', text: 'No changes to save.' });
            return;
        }
        setSubmitting(true);
        try {
            if (baseline && update && onUpdate) {
                const vehicle = await onUpdate(baseline.id, update);
                setBaseline(vehicle);
                setMessage({ kind: 'ok', text: `${vehicle.id} updated.` });
            } else if (onCreate) {
                const vehicle = await onCreate({
                    id: values.id.trim(),
                    name: values.name.trim(),
                    model: values.model.trim(),
                    ...Object.fromEntries(NUMBER_FIELDS.map(({ key }) => [key, Number(values[key])])) as Record<NumberKey, number>,
                    status,
                });
                setDraft(EMPTY_DRAFT);
                setStatus('AVAILABLE');
                setShowErrors(false);
                setMessage({ kind: 'ok', text: `${vehicle.id} added to the fleet.` });
                onCreated?.(vehicle);
            }
        } catch (err) {
            const action = baseline ? 'save changes' : 'add vehicle';
            setMessage({ kind: 'error', text: `Could not ${action}: ${err instanceof Error ? err.message : 'request failed'}` });
        } finally {
            setSubmitting(false);
        }
    };

    const modelError = showErrors ? errors.model : undefined;

    const field = (key: FieldKey, label: string, hint: string, numeric: boolean) => {
        const error = showErrors ? errors[key] : undefined;
        const locked = key === 'id' && !!baseline;
        return (
            <label className={`route-field route-field--${key}`} key={key}>
                <span>{label}</span>
                <input
                    type="text"
                    inputMode={numeric ? 'decimal' : 'text'}
                    name={key}
                    value={draft[key]}
                    required
                    readOnly={locked}
                    aria-invalid={!!error}
                    aria-describedby={`${key}-${error ? 'error' : 'hint'}`}
                    onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
                />
                {error
                    ? <span id={`${key}-error`} className="route-field-error" role="alert">{error}</span>
                    : <span id={`${key}-hint`} className="route-field-hint">{locked ? "IDs can't be changed" : hint}</span>}
            </label>
        );
    };

    return (
        <form className="route-inputs vehicle-form" onSubmit={handleSubmit} noValidate aria-labelledby="vehicle-form-title">
            <div className="setup-header">
                <h2 id="vehicle-form-title">{baseline ? `Edit ${baseline.id}` : 'Add a vehicle'}</h2>
                <p className="route-inputs-hint">
                    {baseline
                        ? 'Only the fields you change are saved. Changing charge or health marks the battery state as manually entered.'
                        : 'Register an EV so it appears on the dashboard and in trip planning.'}
                </p>
            </div>
            <div className="vehicle-form-grid">
                {TEXT_FIELDS.filter(f => baseline || !CATALOG_KEYS.includes(f.key)).map(f => field(f.key, f.label, f.hint, false))}
                {!baseline && (
                    <div className="route-field vehicle-form-wide">
                        <span>Make & model</span>
                        <output className="vehicle-form-model" aria-live="polite">{spec ? spec.model : 'None picked yet'}</output>
                        {modelError
                            ? <span className="route-field-error" role="alert">Pick a model from the garage row first.</span>
                            : <span className="route-field-hint">
                                {spec ? formatEvSpecs(spec) : 'Pick one from the garage row; it sets battery size, efficiency and weight'}
                            </span>}
                    </div>
                )}
                <label className="route-field">
                    <span>Status</span>
                    <select value={status} onChange={e => setStatus(e.target.value)}>
                        {[...new Set([...STATUSES, status])].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                    </select>
                    <span className="route-field-hint">Current operating status</span>
                </label>
                {NUMBER_FIELDS.filter(f => baseline || !CATALOG_KEYS.includes(f.key)).map(f => field(f.key, f.label, f.hint, true))}
            </div>
            <div className="setup-actions">
                <button type="submit" className="simulate-btn" disabled={submitting || !canSubmit}>
                    {baseline ? (submitting ? 'Saving…' : 'Save changes') : (submitting ? 'Adding…' : 'Add vehicle')}
                </button>
                {baseline && (
                    <button type="button" className="ctrl-btn" onClick={onStopEditing}>Done editing</button>
                )}
                {!canSubmit && <span className="route-field-hint">Connect to the fleet backend to change vehicles.</span>}
                {message && (
                    <span className={message.kind === 'ok' ? 'route-field-hint' : 'route-field-error'} role={message.kind === 'ok' ? 'status' : 'alert'}>
                        {message.text}
                    </span>
                )}
            </div>
        </form>
    );
}

interface VehicleActionsProps {
    vehicle: Vehicle;
    canSubmit: boolean;
    isEditing: boolean;
    onEdit: () => void;
    onDelete: (vehicleId: string) => Promise<void>;
}

export function VehicleActions({ vehicle, canSubmit, isEditing, onEdit, onDelete }: VehicleActionsProps) {
    const [confirming, setConfirming] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDelete = async () => {
        setDeleting(true);
        setError(null);
        try {
            await onDelete(vehicle.id);
        } catch (err) {
            setError(`Could not delete: ${err instanceof Error ? err.message : 'request failed'}`);
            setDeleting(false);
        }
    };

    return (
        <section className="panel vehicle-actions" aria-labelledby="vehicle-actions-title">
            <div className="panel-header">
                <h2 className="panel-title" id="vehicle-actions-title">SELECTED · {vehicle.id}</h2>
            </div>
            <p className="route-field-hint">{vehicle.name} · {vehicle.model}</p>
            {confirming ? (
                <div className="vehicle-actions-confirm" role="group" aria-label={`Confirm deleting ${vehicle.id}`}>
                    <p>Delete {vehicle.id}? Its history and telemetry are removed; saved assessments are kept.</p>
                    <div className="vehicle-actions-row">
                        <button type="button" className="ctrl-btn ctrl-btn--danger ctrl-btn--active" disabled={deleting} onClick={handleDelete}>
                            {deleting ? 'Deleting…' : `Delete ${vehicle.id}`}
                        </button>
                        <button type="button" className="ctrl-btn" disabled={deleting} onClick={() => setConfirming(false)}>Keep</button>
                    </div>
                </div>
            ) : (
                <div className="vehicle-actions-row">
                    <button type="button" className="ctrl-btn" disabled={!canSubmit || isEditing} onClick={onEdit}>
                        {isEditing ? 'Editing' : 'Edit'}
                    </button>
                    <button type="button" className="ctrl-btn ctrl-btn--danger" disabled={!canSubmit} onClick={() => setConfirming(true)}>
                        Delete
                    </button>
                </div>
            )}
            {error && <p className="route-field-error" role="alert">{error}</p>}
        </section>
    );
}
