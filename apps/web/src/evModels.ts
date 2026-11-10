// Known EVs offered when registering a vehicle in the garage. Approximate published
// figures (usable battery, typical real-world consumption, curb weight); PoC defaults,
// not OEM-certified values. Truck/van names match the garage's truck body (bodyFor).
export interface EvModel {
    model: string;
    battery_capacity_kwh: number;
    baseline_efficiency_wh_km: number;
    curb_mass_kg: number;
}

export const EV_MODELS: EvModel[] = [
    { model: 'Tesla Model 3 Long Range', battery_capacity_kwh: 75, baseline_efficiency_wh_km: 150, curb_mass_kg: 1830 },
    { model: 'Tesla Model Y Long Range', battery_capacity_kwh: 75, baseline_efficiency_wh_km: 165, curb_mass_kg: 1980 },
    { model: 'Chevrolet Bolt EV', battery_capacity_kwh: 65, baseline_efficiency_wh_km: 160, curb_mass_kg: 1620 },
    { model: 'Nissan Leaf 40 kWh', battery_capacity_kwh: 39, baseline_efficiency_wh_km: 165, curb_mass_kg: 1580 },
    { model: 'Hyundai Ioniq 5 Long Range', battery_capacity_kwh: 74, baseline_efficiency_wh_km: 180, curb_mass_kg: 2100 },
    { model: 'Kia EV6 Long Range', battery_capacity_kwh: 74, baseline_efficiency_wh_km: 175, curb_mass_kg: 2000 },
    { model: 'Volkswagen ID.4 Pro', battery_capacity_kwh: 77, baseline_efficiency_wh_km: 180, curb_mass_kg: 2120 },
    { model: 'Ford Mustang Mach-E Extended Range', battery_capacity_kwh: 88, baseline_efficiency_wh_km: 190, curb_mass_kg: 2230 },
    { model: 'Ford F-150 Lightning Extended Range', battery_capacity_kwh: 131, baseline_efficiency_wh_km: 260, curb_mass_kg: 2950 },
    { model: 'Rivian R1T Large Pack', battery_capacity_kwh: 128, baseline_efficiency_wh_km: 270, curb_mass_kg: 3150 },
    { model: 'Rivian R1S Large Pack', battery_capacity_kwh: 128, baseline_efficiency_wh_km: 275, curb_mass_kg: 3200 },
    { model: 'Chevrolet Silverado EV', battery_capacity_kwh: 200, baseline_efficiency_wh_km: 290, curb_mass_kg: 4100 },
    { model: 'Ford E-Transit Cargo Van', battery_capacity_kwh: 68, baseline_efficiency_wh_km: 280, curb_mass_kg: 2700 },
    { model: 'Mercedes-Benz eSprinter Van', battery_capacity_kwh: 113, baseline_efficiency_wh_km: 300, curb_mass_kg: 3100 },
];

export const formatEvSpecs = (m: EvModel) =>
    `${m.battery_capacity_kwh} kWh · ${m.baseline_efficiency_wh_km} Wh/km · ${m.curb_mass_kg.toLocaleString('en-US')} kg`;
