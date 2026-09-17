from fastapi import APIRouter, HTTPException

from app.api.vehicles import MOCK_FLEET
from app.core.simulator import calculate_simulation
from app.schemas.simulation import (
    BatchSimulationRequest,
    BatchSimulationResponse,
    BatchSimulationResult,
    CompareSimulationRequest,
    CompareSimulationResponse,
    CompareResult,
    SimulationRecord,
    SimulationRequest,
    SimulationResponse,
)

router = APIRouter()

# In-memory simulation history, most recent last
SIMULATION_HISTORY: list[SimulationRecord] = []


@router.post("/run", response_model=SimulationResponse)
def run_simulation(req: SimulationRequest) -> SimulationResponse:
    """Run route range degradation simulation for a specified vehicle and route."""
    vehicle = MOCK_FLEET.get(req.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{req.vehicle_id}' not found")

    result = calculate_simulation(req, vehicle)
    SIMULATION_HISTORY.append(SimulationRecord(request=req, response=result))
    return result


@router.get("/history", response_model=list[SimulationRecord])
def list_simulation_history(vehicle_id: str | None = None) -> list[SimulationRecord]:
    """Retrieve past simulation runs, optionally filtered by vehicle."""
    if vehicle_id is None:
        return SIMULATION_HISTORY
    return [r for r in SIMULATION_HISTORY if r.request.vehicle_id == vehicle_id]


@router.get("/{record_id}", response_model=SimulationRecord)
def get_simulation_record(record_id: str) -> SimulationRecord:
    """Retrieve a single stored simulation run by its record ID."""
    for record in SIMULATION_HISTORY:
        if record.id == record_id:
            return record
    raise HTTPException(status_code=404, detail=f"Simulation record '{record_id}' not found")


@router.post("/batch", response_model=BatchSimulationResponse)
def run_batch_simulation(req: BatchSimulationRequest) -> BatchSimulationResponse:
    """Run the same route/conditions against multiple vehicles (or the whole fleet)."""
    target_ids = req.vehicle_ids if req.vehicle_ids is not None else list(MOCK_FLEET.keys())

    results: list[BatchSimulationResult] = []
    for vehicle_id in target_ids:
        vehicle = MOCK_FLEET.get(vehicle_id)
        if not vehicle:
            results.append(
                BatchSimulationResult(vehicle_id=vehicle_id, error="Vehicle not found")
            )
            continue

        single_req = SimulationRequest(
            vehicle_id=vehicle_id,
            route_distance_km=req.route_distance_km,
            elevation_gain_m=req.elevation_gain_m,
            ambient_temp_c=req.ambient_temp_c,
            payload_kg=req.payload_kg,
            hvac_mode=req.hvac_mode,
            driving_style=req.driving_style,
            regen_level=req.regen_level,
            reserve_soc_target_pct=req.reserve_soc_target_pct,
        )
        response = calculate_simulation(single_req, vehicle)
        SIMULATION_HISTORY.append(SimulationRecord(request=single_req, response=response))
        results.append(BatchSimulationResult(vehicle_id=vehicle_id, response=response))

    return BatchSimulationResponse(results=results)


@router.post("/compare", response_model=CompareSimulationResponse)
def compare_simulations(req: CompareSimulationRequest) -> CompareSimulationResponse:
    """Compare multiple driving-style/HVAC/regen configs for the same vehicle and route."""
    vehicle = MOCK_FLEET.get(req.vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{req.vehicle_id}' not found")

    results: list[CompareResult] = []
    for config in req.configs:
        single_req = SimulationRequest(
            vehicle_id=req.vehicle_id,
            route_distance_km=req.route_distance_km,
            elevation_gain_m=req.elevation_gain_m,
            ambient_temp_c=req.ambient_temp_c,
            payload_kg=req.payload_kg,
            hvac_mode=config.hvac_mode,
            driving_style=config.driving_style,
            regen_level=config.regen_level,
            reserve_soc_target_pct=req.reserve_soc_target_pct,
        )
        response = calculate_simulation(single_req, vehicle)
        SIMULATION_HISTORY.append(SimulationRecord(request=single_req, response=response))
        results.append(CompareResult(label=config.label, response=response))

    return CompareSimulationResponse(vehicle_id=req.vehicle_id, results=results)