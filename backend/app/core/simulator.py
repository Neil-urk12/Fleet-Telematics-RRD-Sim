from app.schemas.simulation import SimulationRequest, SimulationResponse
from app.schemas.vehicle import Vehicle


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

    # Payload penalty: ~0.5% consumption increase per 100 kg
    payload_mult = 1.0 + (req.payload_kg / 100.0) * 0.005

    # Elevation demand (potential energy m*g*h in kWh, assuming ~80% efficiency climbing)
    # Total mass ~ Vehicle curb mass (e.g. 2500kg) + payload
    total_mass_kg = 2500.0 + req.payload_kg
    climb_energy_kwh = (total_mass_kg * 9.81 * req.elevation_gain_m) / (3.6e6 * 0.80)

    # Base propulsion consumption
    base_wh_km = (vehicle.baseline_efficiency_wh_km * style_mult * payload_mult) + hvac_adder
    propulsion_energy_kwh = (base_wh_km * req.route_distance_km) / 1000.0

    total_consumption_kwh = round(propulsion_energy_kwh + climb_energy_kwh, 2)

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
        projected_arrival_soc_pct=projected_arrival_soc,
        remaining_range_km=remaining_range_km,
        risk_level=risk_level,
        confidence_score_pct=confidence_score,
        recommendations=recommendations,
    )
