from fastapi import APIRouter, HTTPException

from app.core import fleet_state, persistence
from app.core.battery_history import assess_battery_history
from app.core.simulator import calculate_simulation
from app.core.soh_projection import fit_soh_trend, project_soh
from app.schemas.simulation import (
    BatchSimulationRequest,
    BatchSimulationResponse,
    BatchSimulationResult,
    CompareResult,
    CompareSimulationRequest,
    CompareSimulationResponse,
    DegradationPoint,
    DegradationResponse,
    SimulationRecord,
    SimulationRequest,
    SimulationResponse,
)
from app.schemas.vehicle import Vehicle

router = APIRouter()

DEGRADATION_HORIZONS_YEARS = (0, 1, 2, 3, 5)

# Process-local cache of persisted simulation history, most recent last.
SIMULATION_HISTORY: list[SimulationRecord] = []


def _record(req: SimulationRequest, result: SimulationResponse) -> None:
    record = SimulationRecord(request=req, response=result)
    with fleet_state.LOCK:
        persistence.save_simulation(record)
        SIMULATION_HISTORY.append(record)


def _vehicle_snapshot(vehicle_id: str) -> Vehicle:
    try:
        return fleet_state.get_vehicle(vehicle_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found") from exc


def _calculate(req: SimulationRequest, vehicle: Vehicle) -> SimulationResponse:
    try:
        return calculate_simulation(req, vehicle)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/run", response_model=SimulationResponse)
def run_simulation(req: SimulationRequest) -> SimulationResponse:
    """Run route range degradation simulation for a specified vehicle and route."""
    vehicle = _vehicle_snapshot(req.vehicle_id)

    result = _calculate(req, vehicle)
    _record(req, result)
    return result


@router.get("/history", response_model=list[SimulationRecord])
def list_simulation_history(vehicle_id: str | None = None) -> list[SimulationRecord]:
    """Retrieve past simulation runs, optionally filtered by vehicle."""
    with fleet_state.LOCK:
        return [
            r
            for r in SIMULATION_HISTORY
            if vehicle_id is None or r.request.vehicle_id == vehicle_id
        ]


@router.get("/{record_id}", response_model=SimulationRecord)
def get_simulation_record(record_id: str) -> SimulationRecord:
    """Retrieve a single stored simulation run by its record ID."""
    with fleet_state.LOCK:
        for record in SIMULATION_HISTORY:
            if record.id == record_id:
                return record
    raise HTTPException(status_code=404, detail=f"Simulation record '{record_id}' not found")


@router.post("/batch", response_model=BatchSimulationResponse)
def run_batch_simulation(req: BatchSimulationRequest) -> BatchSimulationResponse:
    """Run the same route/conditions against multiple vehicles (or the whole fleet)."""
    fleet = {vehicle.id: vehicle for vehicle in fleet_state.list_vehicles()}
    target_ids = req.vehicle_ids if req.vehicle_ids is not None else list(fleet)

    results: list[BatchSimulationResult] = []
    for vehicle_id in target_ids:
        vehicle = fleet.get(vehicle_id)
        if not vehicle:
            results.append(BatchSimulationResult(vehicle_id=vehicle_id, error="Vehicle not found"))
            continue

        single_req = SimulationRequest(
            vehicle_id=vehicle_id,
            route_distance_km=req.route_distance_km,
            elevation_gain_m=req.elevation_gain_m,
            elevation_loss_m=req.elevation_loss_m,
            road_type=req.road_type,
            ambient_temp_c=req.ambient_temp_c,
            payload_kg=req.payload_kg,
            hvac_mode=req.hvac_mode,
            driving_style=req.driving_style,
            regen_level=req.regen_level,
            reserve_soc_target_pct=req.reserve_soc_target_pct,
        )
        try:
            response = calculate_simulation(single_req, vehicle)
        except ValueError as exc:
            results.append(BatchSimulationResult(vehicle_id=vehicle_id, error=str(exc)))
            continue
        _record(single_req, response)
        results.append(BatchSimulationResult(vehicle_id=vehicle_id, response=response))

    return BatchSimulationResponse(results=results)


@router.post("/compare", response_model=CompareSimulationResponse)
def compare_simulations(req: CompareSimulationRequest) -> CompareSimulationResponse:
    """Compare multiple driving-style/HVAC/regen configs for the same vehicle and route."""
    vehicle = _vehicle_snapshot(req.vehicle_id)

    results: list[CompareResult] = []
    for config in req.configs:
        single_req = SimulationRequest(
            vehicle_id=req.vehicle_id,
            route_distance_km=req.route_distance_km,
            elevation_gain_m=req.elevation_gain_m,
            elevation_loss_m=req.elevation_loss_m,
            road_type=req.road_type,
            ambient_temp_c=req.ambient_temp_c,
            payload_kg=req.payload_kg,
            hvac_mode=config.hvac_mode,
            driving_style=config.driving_style,
            regen_level=config.regen_level,
            reserve_soc_target_pct=req.reserve_soc_target_pct,
        )
        response = _calculate(single_req, vehicle)
        _record(single_req, response)
        results.append(CompareResult(label=config.label, response=response))

    return CompareSimulationResponse(vehicle_id=req.vehicle_id, results=results)


@router.post("/degradation", response_model=DegradationResponse)
def project_degradation(req: SimulationRequest) -> DegradationResponse:
    """Assess the same trip at the vehicle's projected future SOH. Nothing is saved:
    the points describe hypothetical battery states, not assessments."""
    vehicle = _vehicle_snapshot(req.vehicle_id)
    try:
        entries = fleet_state.get_vehicle_history(req.vehicle_id)
    except KeyError:  # deleted since the snapshot
        entries = []
    trend = fit_soh_trend(entries, assess_battery_history(vehicle))

    points: list[DegradationPoint] = []
    for years in DEGRADATION_HORIZONS_YEARS:
        soh = project_soh(vehicle.current_soh, trend.soh_loss_pct_per_year, years)
        if soh <= 0 and years > 0:
            break
        response = _calculate(req, vehicle.model_copy(update={"current_soh": soh}))
        points.append(
            DegradationPoint(
                years_ahead=years,
                projected_soh_pct=soh,
                projected_arrival_soc_pct=response.projected_arrival_soc_pct,
                predicted_range_km=response.predicted_range_km,
                risk_level=response.risk_level,
            )
        )

    return DegradationResponse(
        vehicle_id=vehicle.id,
        basis=trend.basis,
        soh_loss_pct_per_year=trend.soh_loss_pct_per_year,
        readings_used=trend.readings_used,
        span_days=trend.span_days,
        points=points,
    )
