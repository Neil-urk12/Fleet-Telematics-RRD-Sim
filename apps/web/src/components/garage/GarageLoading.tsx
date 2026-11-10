// Kept out of GaragePage so App.tsx can show it while the three.js chunk downloads.
import './garage-loading.css';

/** Loading veil content: indeterminate until the scene reports how many cars it is building. */
export function GarageLoadingBody({ built = 0, total = 0 }: { built?: number; total?: number }) {
    return (
        <>
            <p>{total > 0 ? `Parking the fleet… ${built} / ${total}` : 'Opening the garage…'}</p>
            <div
                className="garage-progress"
                role="progressbar"
                aria-label="Garage loading"
                aria-valuemin={0}
                aria-valuemax={total || undefined}
                aria-valuenow={total ? built : undefined}
            >
                <i
                    className={total ? undefined : 'indeterminate'}
                    style={total ? { width: `${((built / total) * 100).toFixed(1)}%` } : undefined}
                />
            </div>
        </>
    );
}

/** Stand-in for the garage while the fleet loads and the 3D code downloads. */
export function GaragePlaceholder() {
    return (
        <section className="garage-placeholder" aria-label="Fleet garage">
            <div className="garage-loading" role="status">
                <GarageLoadingBody />
            </div>
        </section>
    );
}
