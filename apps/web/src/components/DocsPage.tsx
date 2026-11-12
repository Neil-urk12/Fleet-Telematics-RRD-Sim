// Static reference for the backend model. Keep in step with backend/app/core/
// simulator.py, battery_history.py and soh_projection.py when coefficients change.

const GLOSSARY: [term: string, meaning: string][] = [
    ['SOC (state of charge)', 'How full the battery is right now, as a percentage of its usable capacity.'],
    ['SOH (state of health)', 'How much of its original capacity the battery still holds. A 75 kWh pack at 90% SOH stores 67.5 kWh.'],
    ['Nominal capacity', 'The battery capacity of a new pack, in kWh, from the vehicle specification.'],
    ['Usable capacity', 'Nominal capacity after SOH, history stress and outside temperature are applied. Every SOC percentage in a result refers to this figure.'],
    ['Baseline efficiency', 'Energy the vehicle uses per kilometre on a flat mixed road with normal driving, in Wh/km.'],
    ['Curb mass', 'Weight of the empty vehicle, in kg.'],
    ['Payload', 'Weight of cargo and passengers added for the trip, in kg.'],
    ['Ascent / descent', 'Total metres climbed and total metres descended over the whole route. Their order along the route is not modelled.'],
    ['HVAC', 'Heating, ventilation and air conditioning. It adds a fixed energy cost per kilometre.'],
    ['Regen (regenerative braking)', 'Energy put back into the battery while going downhill. Only the route descent is counted, not braking in traffic.'],
    ['Reserve', 'The SOC you want left on arrival, 0–50%. It is the safety margin the risk level is judged against.'],
    ['Arrival SOC', 'Predicted SOC at the end of the trip. It can be negative, meaning the trip needs more energy than the battery holds.'],
    ['Remaining range', 'Distance the vehicle could still drive after the trip, at the same consumption rate.'],
    ['Predicted range', 'Distance the vehicle could drive from its starting charge, at the trip’s consumption rate.'],
    ['Risk level', 'SAFE, CAUTION or NOT RECOMMENDED, from comparing arrival SOC with the reserve.'],
    ['Uncertainty band', 'The ± percentage applied to trip energy, giving the low and high values for arrival SOC and range.'],
    ['Confidence score', 'Estimated chance of arriving at or above the reserve. A rule-of-thumb figure, not a calibrated probability.'],
    ['Equivalent full cycles', 'Total energy charged over the battery’s life, counted in full charges. Two charges from 50% to 100% make one cycle.'],
    ['DoD (depth of discharge)', 'How far the battery is typically drained between charges, as a percentage.'],
    ['Fast-charge share', 'Percentage of charging done on DC fast chargers.'],
    ['Thermal stress index', 'A reported 0–100 figure for how much heat the pack has been exposed to.'],
    ['History stress score', 'A 0–100 score built from cycles, DoD, fast-charge share and thermal stress, classed NORMAL, ELEVATED or HIGH.'],
    ['Telemetry', 'Readings a vehicle reports: SOC, SOH, speed, odometer, outside and pack temperature, position.'],
    ['State source', 'Where a vehicle’s current SOC and SOH came from: its registered defaults, a manual edit, or telemetry.'],
    ['Battery ageing outlook', 'The same trip assessed again at the SOH projected for later years.'],
];

const FORMULAS: { title: string; intro: string; formula: string; notes?: string[] }[] = [
    {
        title: '1. Usable capacity and starting energy',
        intro: 'Capacity is reduced in three steps: battery health, usage history, then outside temperature.',
        formula: `usable capacity (kWh) = nominal capacity × SOH / 100
                        × history factor
                        × temperature factor

starting energy (kWh) = usable capacity × SOC / 100`,
        notes: [
            'Temperature factor: below 0 °C 0.80 · below 15 °C 0.90 · above 35 °C 0.95 · otherwise 1.00.',
            'A usable capacity of zero cannot be assessed and is rejected.',
        ],
    },
    {
        title: '2. History stress',
        intro: 'Each reported indicator is scaled to 0–1, weighted, and combined into a 0–100 score.',
        formula: `cycles      = min(1, cycle count / 1500)            weight 0.30
DoD         = clamp((avg DoD − 50) / 50, 0, 1)      weight 0.30
fast charge = min(1, fast-charge share / 50)        weight 0.20
thermal     = min(1, thermal stress index / 100)    weight 0.20

stress score   = 100 × Σ(weight × value) / Σ(weights of reported indicators)
history factor = 1 − 0.04 × stress score / 100`,
        notes: [
            'Class: below 35 NORMAL · 35 to below 70 ELEVATED · 70 and above HIGH.',
            'Unreported indicators are left out and the remaining weights rescaled. With no history reported, the factor is 1 and there is no score.',
            'The factor removes at most 4% of capacity, because SOH already reflects most past wear.',
        ],
    },
    {
        title: '3. Trip energy',
        intro: 'Energy demand is the sum of driving, climate control and climbing, less the energy recovered downhill.',
        formula: `payload factor  = 1 + 0.125 × payload / curb mass

propulsion (kWh) = baseline efficiency × road × style × payload factor
                   × distance / 1000
HVAC (kWh)       = HVAC rate × distance / 1000
climb (kWh)      = (curb mass + payload) × 9.81 × ascent / (3 600 000 × 0.80)

recovery per kg  = 9.81 × descent / 3 600 000 × regen efficiency × regen level
regen (kWh)      = curb mass × recovery per kg
                   + min(payload × recovery per kg, payload’s added demand)

trip energy (kWh) = propulsion + HVAC + climb − regen`,
        notes: [
            'Road: URBAN 1.05 · HIGHWAY 1.15 · MIXED 1.00.',
            'Driving style: ECO 0.88 · NORMAL 1.00 · AGGRESSIVE 1.25.',
            'HVAC rate (Wh/km): OFF 0 · LOW 15 · MEDIUM 30 · HIGH 55.',
            'Regen level: OFF 0 · LOW 0.35 · MEDIUM 0.65 · HIGH 1.00. Regen efficiency is a vehicle value, 0.60 by default.',
            'Climbing is assumed 80% efficient. Regen can never exceed the trip’s total demand, and extra payload can never improve the result.',
        ],
    },
    {
        title: '4. Arrival SOC and range',
        intro: 'What is left after the trip, as a percentage and as distance.',
        formula: `energy left (kWh)   = starting energy − trip energy
arrival SOC (%)     = energy left / usable capacity × 100

consumption (kWh/km) = max(0.05, trip energy / distance)
remaining range (km) = max(0, energy left) / consumption
predicted range (km) = starting energy / consumption`,
    },
    {
        title: '5. Risk level',
        intro: 'Arrival SOC is compared with the reserve you chose.',
        formula: `arrival SOC ≥ reserve        →  SAFE
arrival SOC ≥ reserve / 2    →  CAUTION
otherwise                    →  NOT RECOMMENDED`,
    },
    {
        title: '6. Uncertainty band and confidence',
        intro: 'The band widens when conditions make the estimate less reliable.',
        formula: `uncertainty (%) = 5
                + 5 if below 0 °C, or 3 if above 35 °C
                + 4 if AGGRESSIVE driving
                + 2 if URBAN road
                + 2 if ELEVATED history stress, or 4 if HIGH
                + 3 if SOH below 80%

low / high arrival SOC = arrival SOC at trip energy × (1 ± uncertainty / 100)
low / high range       = predicted range at consumption × (1 ± uncertainty / 100)

margin (kWh)   = energy left − usable capacity × reserve / 100
σ (kWh)        = trip energy × (uncertainty / 100) / 1.645
confidence (%) = Φ(margin / σ) × 100`,
        notes: [
            'Φ is the standard normal cumulative distribution. The band is treated as a 90% interval, so confidence is 50% when arrival SOC equals the reserve.',
        ],
    },
    {
        title: '7. Battery ageing outlook',
        intro: 'SOH is projected forward in a straight line and the trip is assessed again at each point. Nothing else changes.',
        formula: `projected SOH (%) = max(0, current SOH − loss rate × years)     years = 0, 1, 2, 3, 5

loss rate (% per year)
  recorded: least-squares slope of recorded SOH over time, never below 0
            (needs readings spanning at least 30 days)
  assumed:  2.0 × (1 + history stress score / 100)`,
        notes: [
            'The table caption says which rate was used. Years where projected SOH reaches 0 are left out.',
            'This is a linear projection, not a cell-ageing model.',
        ],
    },
];

export function DocsPage() {
    return (
        <div className="docs">
            <p className="docs-note" role="note">
                These are proof-of-concept calibration values chosen for this project, not measured
                manufacturer data. The mobile app’s offline estimate and the route page’s SOC chart use
                simpler approximations than the formulas below.
            </p>

            <section className="docs-section" aria-labelledby="docs-glossary">
                <h2 id="docs-glossary">Glossary</h2>
                <dl className="docs-glossary">
                    {GLOSSARY.map(([term, meaning]) => (
                        <div key={term}>
                            <dt>{term}</dt>
                            <dd>{meaning}</dd>
                        </div>
                    ))}
                </dl>
            </section>

            <section className="docs-section" aria-labelledby="docs-formulas">
                <h2 id="docs-formulas">Formulas</h2>
                <p>How the backend turns a vehicle and a trip into a result, in the order it calculates them.</p>
                {FORMULAS.map(({ title, intro, formula, notes }) => (
                    <article className="docs-formula" key={title}>
                        <h3>{title}</h3>
                        <p>{intro}</p>
                        <pre tabIndex={0} aria-label={`${title} formula`}>{formula}</pre>
                        {notes && <ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>}
                    </article>
                ))}
            </section>
        </div>
    );
}
