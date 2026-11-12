import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatBatteryState } from '@fleet/api-client';
import type { Vehicle, VehicleCreate } from '@fleet/api-client';
import { VehicleForm } from '../VehicleForm';
import { EV_MODELS } from '../../evModels';
import { BODY_LABEL, bodyFor, createGarage } from './scene.js';
import type { Garage, GarageView } from './scene.js';
import { GarageLoadingBody } from './GarageLoading';
import './garage.css';

const VIEWS: [GarageView, string][] = [['hero', 'Hero'], ['side', 'Side'], ['rear', 'Rear'], ['top', 'Above']];
const pad = (n: number) => String(n).padStart(2, '0');
const barWidth = (fraction: number) => `${(Math.min(1, Math.max(0.04, fraction)) * 100).toFixed(1)}%`;

interface GaragePageProps {
    vehicles: Vehicle[];
    selectedId: string | null;
    onSelect: (vehicleId: string) => void;
    /** Adds a "New vehicle" bay: pick a known EV from the row, then register it. Omit when vehicles can't be created. */
    onCreate?: (payload: VehicleCreate) => Promise<Vehicle>;
    /** IDs that saved assessments refer to; a new vehicle is never given one. */
    retiredIds?: string[];
}

export function GaragePage({ vehicles, selectedId, onSelect, onCreate, retiredIds }: GaragePageProps) {
    // The 3D cars are built from the fleet when the page mounts (plus any registered here); live SOC/SOH still refresh by ID below.
    const [roster, setRoster] = useState(vehicles);
    const [adding, setAdding] = useState(false);
    const showForm = !!onCreate && (adding || roster.length === 0);
    const [idx, setIdx] = useState(() => Math.max(0, roster.findIndex(v => v.id === selectedId)));
    // Registration: the catalog model on the lift (index into EV_MODELS) and its preview thumbnails.
    const [pick, setPick] = useState<number | null>(null);
    const [catalogThumbs, setCatalogThumbs] = useState<string[] | null>(null);
    const [thumbs, setThumbs] = useState<string[] | null>(null);
    const [catalogDone, setCatalogDone] = useState(false);
    const [built, setBuilt] = useState<[number, number]>([0, 0]);
    const [error, setError] = useState<string | null>(null);
    const [activeView, setActiveView] = useState<GarageView | null>('hero');
    const [spin, setSpin] = useState(() => !matchMedia('(prefers-reduced-motion: reduce)').matches);
    const rootRef = useRef<HTMLDivElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const garageRef = useRef<Garage | null>(null);
    const busyRef = useRef(false);
    // Bottom row scroll arrows: disabled at the row's ends.
    const railRef = useRef<HTMLDivElement | null>(null);
    const [railEdge, setRailEdge] = useState({ start: true, end: false });
    const syncRailEdge = useCallback((el: HTMLDivElement) => {
        const start = el.scrollLeft <= 1, end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
        setRailEdge(prev => (prev.start === start && prev.end === end ? prev : { start, end }));
    }, []);
    // The fleet row and the model row are separate elements; measure whichever mounts.
    const attachRail = useCallback((el: HTMLDivElement | null) => {
        railRef.current = el;
        if (el) syncRailEdge(el);
    }, [syncRailEdge]);
    const scrollRail = (dir: 1 | -1) => {
        const el = railRef.current;
        if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
    };
    // Keyboard/arrow picks can land off-screen; bring that slot into view.
    const revealSlot = (i: number) =>
        railRef.current?.children[i]?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    const startIdx = useRef(idx);
    const startRoster = useRef(roster);
    const startCatalog = useRef(onCreate ? EV_MODELS.map(m => m.model) : []);

    useEffect(() => {
        // A fresh canvas per mount: a disposed WebGL context cannot be reused (StrictMode remounts).
        const canvas = document.createElement('canvas');
        canvas.className = 'garage-stage';
        canvas.tabIndex = 0;
        canvas.setAttribute('aria-label', '3D garage view. Drag to look around, scroll or pinch to zoom.');
        stageRef.current!.appendChild(canvas);
        let live = true;
        let garage: Garage;
        try {
            garage = createGarage({
                canvas, root: rootRef.current!, vehicles: startRoster.current, catalog: startCatalog.current,
                startIndex: startIdx.current, onUserOrbit: () => setActiveView(null),
                onProgress: (n, total) => { if (live) setBuilt([n, total]); },
            });
        } catch (e) {
            console.error(e);
            setError('This browser could not start 3D (WebGL).');
            canvas.remove();
            return;
        }
        garageRef.current = garage;
        garage.ready.then(
            t => { if (live) setThumbs(t); },
            e => { console.error(e); if (live) setError('The garage could not load.'); },
        );
        garage.catalogReady.then(
            t => { if (live) setCatalogThumbs(t); },
            () => { /* reported via ready */ },
        ).finally(() => { if (live) setCatalogDone(true); });
        return () => { live = false; garage.dispose(); garageRef.current = null; canvas.remove(); };
    }, []);

    const goTo = async (i: number) => {
        const garage = garageRef.current;
        if (!garage || !thumbs || busyRef.current || roster.length === 0) return;
        const next = (i + roster.length) % roster.length;
        if (next === idx) return;
        busyRef.current = true;
        setIdx(next);
        revealSlot(next);
        await garage.select(next);
        busyRef.current = false;
    };
    const pickModel = async (i: number) => {
        if (busyRef.current) return;
        const next = (i + EV_MODELS.length) % EV_MODELS.length;
        setPick(next);
        revealSlot(next);
        const garage = garageRef.current;
        if (!garage || !catalogThumbs) return; // no 3D: the form still takes the pick
        busyRef.current = true;
        await garage.preview(EV_MODELS[next].model);
        busyRef.current = false;
    };
    const backToFleet = async () => {
        if (busyRef.current) return;
        setAdding(false);
        setPick(null);
        const garage = garageRef.current;
        if (!garage || !thumbs) return;
        busyRef.current = true;
        await garage.select(idx); // a preview may be on the lift
        busyRef.current = false;
    };
    const handleCreated = async (created: Vehicle) => {
        const next = roster.length;
        setRoster(r => [...r, created]);
        setAdding(false);
        setPick(null);
        setIdx(next);
        const garage = garageRef.current;
        if (!garage) return; // no 3D: the vehicle sheet still shows it
        busyRef.current = true;
        try {
            await garage.ready; // rejects if the 3D load failed; that error is already shown
            const thumb = garage.add(created); // not inside the updater: React may run updaters late or twice
            setThumbs(t => [...(t ?? []), thumb]);
            await garage.select(next); // swaps the preview for the registered car, plate and all
        } catch (e) {
            console.error(e); // a failed load is shown (and logged) by the load effect too
        } finally {
            busyRef.current = false;
        }
    };
    const chooseView = (view: GarageView) => {
        garageRef.current?.view(view);
        setActiveView(view);
        setSpin(false);
    };
    const toggleSpin = () => {
        garageRef.current?.setSpin(!spin);
        setSpin(!spin);
    };
    const step = (dir: 1 | -1) => {
        if (!showForm) void goTo(idx + dir);
        else void pickModel(pick === null ? (dir > 0 ? 0 : -1) : pick + dir);
    };

    const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        e.stopPropagation(); // the app's global playback shortcuts must not fire while driving the garage
        if ((e.target as HTMLElement).closest('form')) return; // typing in the form, not driving the garage
        if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
        else if (e.key >= '1' && e.key <= '4') chooseView(VIEWS[Number(e.key) - 1][0]);
    };

    const vehicle = roster[idx] && (vehicles.find(v => v.id === roster[idx].id) ?? roster[idx]);
    const spec = pick === null ? null : EV_MODELS[pick];
    const ready = thumbs !== null;
    const status = vehicle?.status.replace('_', ' ');
    const stress = vehicle?.battery_history?.stress_class;
    const specs: [string, string, string, number][] = !vehicle ? [] : [
        ['State of charge', vehicle.current_soc.toFixed(0), '%', vehicle.current_soc / 100],
        ['Battery health', vehicle.current_soh.toFixed(1), '%', vehicle.current_soh / 100],
        ['Battery capacity', String(vehicle.battery_capacity_kwh), 'kWh', vehicle.battery_capacity_kwh / 200],
        ['Efficiency', String(vehicle.baseline_efficiency_wh_km), 'Wh/km', vehicle.baseline_efficiency_wh_km / 300],
    ];
    if (vehicle?.curb_mass_kg != null) {
        specs.push(['Curb mass', vehicle.curb_mass_kg.toLocaleString('en-US'), 'kg', vehicle.curb_mass_kg / 3500]);
    }

    // What the big headline shows: the picked catalog model, the prompt to pick one, or the fleet car.
    const ident = showForm
        ? spec
            ? {
                key: spec.model, marque: 'New vehicle', name: spec.model, tagline: 'Add a name to register it.',
                chips: [BODY_LABEL[bodyFor(spec.model)], `${spec.battery_capacity_kwh} kWh`, `${spec.baseline_efficiency_wh_km} Wh/km`, `${spec.curb_mass_kg.toLocaleString('en-US')} kg`],
            }
            : {
                key: 'pick', marque: roster.length ? 'New vehicle' : 'Empty garage', name: 'Choose a model',
                tagline: 'Pick an EV from the row below to bring it up on the lift.', chips: [],
            }
        : vehicle
            ? {
                key: vehicle.id, marque: `${vehicle.id} · ${status}`, name: vehicle.name, tagline: vehicle.model,
                chips: [BODY_LABEL[bodyFor(vehicle.model)], `${vehicle.battery_capacity_kwh} kWh`, status!, ...(stress ? [`${stress.toLowerCase()} battery stress`] : [])],
            }
            : { key: 'empty', marque: 'Empty garage', name: 'No vehicles yet', tagline: 'Connect to the fleet backend to register one.', chips: [] };

    return (
        <section
            className={showForm ? 'garage garage--adding' : 'garage'}
            ref={rootRef}
            tabIndex={-1} // clicks on non-focusable areas keep focus (and arrow keys) in the garage
            aria-labelledby="garage-title"
            onKeyDown={onKeyDown}
        >
            <div ref={stageRef} className="garage-stage-wrap" />
            <div className="garage-vignette" aria-hidden="true" />

            <header className="garage-top">
                <div className="garage-brand">
                    <div className="garage-brand-mark" aria-hidden="true">09</div>
                    <div className="garage-brand-txt">
                        <b id="garage-title">Fleet garage</b>
                        <span>{showForm ? `Register a vehicle · ${EV_MODELS.length} models` : `${onCreate ? 'Choose or add a vehicle' : 'Choose a vehicle'} · ${roster.length} bays`}</span>
                    </div>
                </div>
                <div className="garage-top-r">
                    <div className="garage-counter" aria-live="polite">
                        {showForm
                            ? <><b>{pad(pick === null ? 0 : pick + 1)}</b> / {pad(EV_MODELS.length)}</>
                            : <><b>{pad(vehicle ? idx + 1 : 0)}</b> / {pad(roster.length)}</>}
                    </div>
                </div>
            </header>

            <section className="garage-ident" aria-live="polite">
                <div className="garage-marque">{ident.marque}</div>
                <h2 className={ident.name.length > 14 ? 'garage-car-name garage-car-name--long' : 'garage-car-name'} key={ident.key} aria-label={ident.name}>
                    {/* Letters animate one by one; each word stays together so lines only break between words. */}
                    {ident.name.split(' ').map((word, w, words) => {
                        const start = words.slice(0, w).join(' ').length + (w > 0 ? 1 : 0);
                        return (
                            <Fragment key={w}>
                                {w > 0 && ' '}
                                <span className="word" aria-hidden="true">
                                    {[...word].map((c, i) => (
                                        <span className="ch" key={i} style={{ animationDelay: `${(start + i) * 28}ms` }}>{c}</span>
                                    ))}
                                </span>
                            </Fragment>
                        );
                    })}
                </h2>
                <p className="garage-tagline">{ident.tagline}</p>
                {ident.chips.length > 0 && (
                    <div className="garage-chips">
                        {ident.chips.map(chip => <span className="garage-chip" key={chip}>{chip}</span>)}
                    </div>
                )}
            </section>

            <div className="garage-panels">
                {showForm ? (
                    <aside className="garage-form" aria-label={`New vehicle, bay ${pad(roster.length + 1)}`}>
                        <VehicleForm vehicles={vehicles} retiredIds={retiredIds} canSubmit editing={null} spec={spec} onCreate={onCreate} onCreated={handleCreated} />
                    </aside>
                ) : vehicle && <aside className="garage-sheet" aria-label="Vehicle sheet">
                    <div className="garage-sheet-h">
                        <b>Vehicle sheet</b>
                        <span>{vehicle.id}<br />Bay {pad(idx + 1)}</span>
                    </div>
                    {specs.map(([label, value, unit, fraction]) => (
                        <div className="garage-spec" key={label}>
                            <span className="k">{label}</span>
                            <span className="v">{value}<small>{unit}</small></span>
                            <span className="bar" aria-hidden="true"><i style={{ width: barWidth(fraction) }} /></span>
                        </div>
                    ))}
                    <div className="garage-spec-foot">{formatBatteryState(vehicle)}</div>
                </aside>}

                <div className="garage-bottom-l">
                    <div className="garage-views" role="group" aria-label="Camera">
                        {VIEWS.map(([view, label]) => (
                            <button key={view} type="button" aria-pressed={activeView === view} onClick={() => chooseView(view)}>{label}</button>
                        ))}
                        <button type="button" aria-pressed={spin} onClick={toggleSpin}>Turntable</button>
                    </div>
                    <div className="garage-rail-row">
                    <button type="button" className="garage-rail-btn" aria-label={showForm ? 'Previous models' : 'Previous vehicles'} disabled={railEdge.start} onClick={() => scrollRail(-1)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
                    </button>
                    {showForm ? (
                        <div className="garage-rail" role="list" aria-label="EV models" key="models" ref={attachRail} onScroll={e => syncRailEdge(e.currentTarget)}>
                            {EV_MODELS.map((m, i) => (
                                <button
                                    key={m.model}
                                    type="button"
                                    role="listitem"
                                    className="garage-slot"
                                    aria-current={i === pick}
                                    aria-label={`${m.model}, ${m.battery_capacity_kwh} kWh`}
                                    disabled={!catalogThumbs && !error}
                                    onClick={() => void pickModel(i)}
                                >
                                    <span className="slot-n">{pad(i + 1)}</span>
                                    {catalogThumbs?.[i] ? <img alt="" src={catalogThumbs[i]} /> : <span className="slot-img-ph" />}
                                    <span className="slot-t">{m.model}</span>
                                    <span className="slot-s">{m.battery_capacity_kwh} kWh · {BODY_LABEL[bodyFor(m.model)]}</span>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="garage-rail" role="list" aria-label="Vehicles in the garage" key="fleet" ref={attachRail} onScroll={e => syncRailEdge(e.currentTarget)}>
                            {roster.map((r, i) => (
                                <button
                                    key={r.id}
                                    type="button"
                                    role="listitem"
                                    className="garage-slot"
                                    aria-current={i === idx}
                                    aria-label={`${r.name}, ${r.id}, ${r.model}`}
                                    disabled={!ready}
                                    onClick={() => void goTo(i)}
                                >
                                    <span className="slot-n">{pad(i + 1)}</span>
                                    {thumbs?.[i] ? <img alt="" src={thumbs[i]} /> : <span className="slot-img-ph" />}
                                    <span className="slot-t">{r.name}</span>
                                    <span className="slot-s">{r.id} · {r.model}</span>
                                </button>
                            ))}
                            {onCreate && (
                                <button type="button" role="listitem" className="garage-slot garage-slot--new" onClick={() => setAdding(true)}>
                                    <span className="slot-n">{pad(roster.length + 1)}</span>
                                    <span className="slot-img-ph" aria-hidden="true">+</span>
                                    <span className="slot-t">New vehicle</span>
                                    <span className="slot-s">Register an EV</span>
                                </button>
                            )}
                        </div>
                    )}
                    <button type="button" className="garage-rail-btn" aria-label={showForm ? 'More models' : 'More vehicles'} disabled={railEdge.end} onClick={() => scrollRail(1)}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                    </button>
                    </div>
                </div>

                <div className="garage-dock">
                    {showForm && roster.length > 0 && (
                        <button type="button" className="garage-act" onClick={() => void backToFleet()}>Back to fleet</button>
                    )}
                    {vehicle && !showForm && (
                        // The selection is shared with the planner, route and battery pages.
                        <button
                            type="button"
                            className="garage-act garage-act--primary"
                            disabled={!ready || vehicle.id === selectedId}
                            onClick={() => onSelect(vehicle.id)}
                        >
                            {vehicle.id === selectedId ? `${vehicle.name} selected` : `Select ${vehicle.name}`}
                        </button>
                    )}
                </div>
            </div>

            <p className="garage-hint" aria-hidden="true">Drag to look around · scroll to zoom · ← → to swap</p>

            {/* Held until the catalog previews are built too: building them stalls the main thread. */}
            {(!ready || !catalogDone || error) && (
                <div className="garage-loading" role="status">
                    {error
                        ? <><p>{error}</p><p>{onCreate ? 'Use the fleet list on the Vehicles page instead.' : 'Use the “Which vehicle?” dropdown instead.'}</p></>
                        : <GarageLoadingBody built={built[0]} total={built[1]} />}
                </div>
            )}
        </section>
    );
}
