from app.schemas.simulation import SimulationRequest, SimulationResponse
from app.schemas.vehicle import Vehicle

# Illustrative PoC calibration coefficients, not measured OEM performance.
ROAD_MULTIPLIERS = {"URBAN": 1.05, "HIGHWAY": 1.15, "MIXED": 1.0}
REGEN_MULTIPLIERS = {"OFF": 0.0, "LOW": 0.35, "MEDIUM": 0.65, "HIGH": 1.0}
CLIMB_EFFICIENCY = 0.80
PAYLOAD_MASS_COEFFICIENT = 0.125


def calculate_simulation(req: SimulationRequest, vehicle: Vehicle) -> SimulationResponse:
    # 1. Battery Degradation & Available Energy Calculation
    soh_factor = vehicle.current_soh / 100.0
    usable_capacity_kwh = vehicle.battery_capacity_kwh * soh_factor

    # Temperature derating factor for battery capacity
    if req.ambient_temp_c < 0:
        temp_capacity_factor = 0.80
    elif req.ambient_temp_c < 15:
        temp_capacity_factor = 0.90
    elif req.ambient_temp_c > 35:
        temp_capacity_factor = 0.95
    else:
        temp_capacity_factor = 1.0

    effective_usable_kwh = usable_capacity_kwh * temp_capacity_factor
    if effective_usable_kwh <= 0:
        raise ValueError("Vehicle has no usable battery capacity; route assessment is unavailable")
    current_energy_kwh = effective_usable_kwh * (vehicle.current_soc / 100.0)

    # 2. Consumption Modifiers
    # Driving style modifier
    style_multipliers = {"ECO": 0.88, "NORMAL": 1.0, "AGGRESSIVE": 1.25}
    style_mult = style_multipliers.get(req.driving_style, 1.0)

    # HVAC demand modifier (kW power or Wh/km equivalent)
    hvac_adders = {"OFF": 0.0, "LOW": 15.0, "MEDIUM": 30.0, "HIGH": 55.0}  # Wh/km
    hvac_adder = hvac_adders.get(req.hvac_mode, 30.0)

    # Scale the payload penalty relative to unloaded vehicle mass.
    # At the legacy 2500 kg default this retains +0.5% per 100 kg.
    payload_mult = 1.0 + PAYLOAD_MASS_COEFFICIENT * req.payload_kg / vehicle.curb_mass_kg

    # Elevation demand (potential energy m*g*h in kWh, assuming ~80% efficiency climbing)
    total_mass_kg = vehicle.curb_mass_kg + req.payload_kg
    climb_energy_kwh = (total_mass_kg * 9.81 * req.elevation_gain_m) / (3.6e6 * CLIMB_EFFICIENCY)

    # Base propulsion consumption
    base_wh_km = (
        vehicle.baseline_efficiency_wh_km
        * ROAD_MULTIPLIERS[req.road_type]
        * style_mult
        * payload_mult
    )
    propulsion_energy_kwh = (base_wh_km * req.route_distance_km) / 1000.0
    hvac_energy_kwh = hvac_adder * req.route_distance_km / 1000.0

    gross_energy_kwh = propulsion_energy_kwh + hvac_energy_kwh + climb_energy_kwh
    recovery_per_kg_kwh = (
        9.81
        * req.elevation_loss_m
        / 3.6e6
        * vehicle.regen_efficiency
        * REGEN_MULTIPLIERS[req.regen_level]
    )
    payload_demand_kwh = (
        propulsion_energy_kwh
        - propulsion_energy_kwh / payload_mult
        + req.payload_kg * 9.81 * req.elevation_gain_m / (3.6e6 * CLIMB_EFFICIENCY)
    )
    # Conservative PoC policy: payload recovery can offset its added demand,
    # but carrying more cargo must never improve arrival SOC or remaining range.
    payload_recovery_kwh = min(req.payload_kg * recovery_per_kg_kwh, payload_demand_kwh)
    # Conservative route-average recovery: no net charging is predicted without
    # segment order, pack headroom, or regen power limits.
    recovered_regen_kwh = min(
        gross_energy_kwh,
        vehicle.curb_mass_kg * recovery_per_kg_kwh + payload_recovery_kwh,
    )
    total_consumption_kwh = round(gross_energy_kwh - recovered_regen_kwh, 2)

    # 3. Projected Arrival SOC and Remaining Range
    remaining_energy_kwh = current_energy_kwh - total_consumption_kwh
    projected_arrival_soc = round((remaining_energy_kwh / effective_usable_kwh) * 100.0, 1)

    average_efficiency_kwh_km = (
        (total_consumption_kwh / req.route_distance_km) if req.route_distance_km > 0 else 0.3
    )
    remaining_range_km = round(
        max(0.0, remaining_energy_kwh / max(0.05, average_efficiency_kwh_km)), 1
    )

    # 4. Risk Classification & Decision Support
    recommendations: list[str] = []
    if projected_arrival_soc >= req.reserve_soc_target_pct:
        risk_level = "SAFE"
        confidence_score = 92.0
        recommendations.append("Route is safe to proceed under current operational parameters.")
    elif projected_arrival_soc >= (req.reserve_soc_target_pct / 2.0):
        risk_level = "CAUTION"
        confidence_score = 75.0
        recommendations.append("Arrival SOC will fall below target reserve margin.")
        if req.driving_style == "AGGRESSIVE":
            recommendations.append("Switch driving profile to ECO to conserve battery.")
        if req.hvac_mode == "HIGH":
            recommendations.append("Reduce HVAC demand to MEDIUM or LOW.")
        recommendations.append("Consider a 10-15 minute top-up charge before departure.")
    else:
        risk_level = "NOT_RECOMMENDED"
        confidence_score = 88.0
        recommendations.append(
            "Route cannot be safely completed without en-route or pre-departure charging."
        )
        recommendations.append("Reassign to a vehicle with higher initial SOC or higher SOH.")

    return SimulationResponse(
        vehicle_id=vehicle.id,
        starting_soc_pct=vehicle.current_soc,
        starting_soh_pct=vehicle.current_soh,
        state_source=vehicle.state_source,
        state_timestamp=vehicle.state_timestamp,
        usable_battery_capacity_kwh=round(effective_usable_kwh, 2),
        estimated_energy_consumption_kwh=total_consumption_kwh,
        propulsion_energy_kwh=round(propulsion_energy_kwh, 2),
        hvac_energy_kwh=round(hvac_energy_kwh, 2),
        climb_energy_kwh=round(climb_energy_kwh, 2),
        recovered_regen_energy_kwh=round(recovered_regen_kwh, 2),
        projected_arrival_soc_pct=projected_arrival_soc,
        remaining_range_km=remaining_range_km,
        risk_level=risk_level,
        confidence_score_pct=confidence_score,
        recommendations=recommendations,
    )
