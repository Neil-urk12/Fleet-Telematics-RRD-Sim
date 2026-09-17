from fastapi import APIRouter, HTTPException

from app.schemas.vehicle import Vehicle

router = APIRouter()

# Mock vehicle data store for initial development
MOCK_FLEET: dict[str, Vehicle] = {
    "EV-001": Vehicle(
        id="EV-001",
        name="Alpha",
        model="Tesla Model 3",
        battery_capacity_kwh=75.0,
        baseline_efficiency_wh_km=160.0,
        current_soc=82.4,
        current_soh=96.1,
        status="IN_USE",
    ),
    "EV-002": Vehicle(
        id="EV-002",
        name="Bravo",
        model="Rivian R1T",
        battery_capacity_kwh=135.0,
        baseline_efficiency_wh_km=210.0,
        current_soc=61.8,
        current_soh=91.3,
        status="IN_USE",
    ),
    "EV-003": Vehicle(
        id="EV-003",
        name="Charlie",
        model="Ford F-150L",
        battery_capacity_kwh=98.0,
        baseline_efficiency_wh_km=240.0,
        current_soc=38.5,
        current_soh=88.7,
        status="IN_USE",
    ),
    "EV-004": Vehicle(
        id="EV-004",
        name="Delta",
        model="Tesla Model Y",
        battery_capacity_kwh=82.0,
        baseline_efficiency_wh_km=155.0,
        current_soc=91.2,
        current_soh=97.4,
        status="CHARGING",
    ),
    "EV-005": Vehicle(
        id="EV-005",
        name="Echo",
        model="Chevy Silverado EV",
        battery_capacity_kwh=200.0,
        baseline_efficiency_wh_km=280.0,
        current_soc=25.3,
        current_soh=84.2,
        status="MAINTENANCE",
    ),
    "EV-006": Vehicle(
        id="EV-006",
        name="Foxtrot",
        model="Rivian R1S",
        battery_capacity_kwh=135.0,
        baseline_efficiency_wh_km=220.0,
        current_soc=74.6,
        current_soh=93.8,
        status="AVAILABLE",
    ),
}

VEHICLE_HISTORY: dict[str, list[VehicleHistoryEntry]] = {
    vid: [VehicleHistoryEntry(current_soc=v.current_soc, current_soh=v.current_soh, status=v.status)]
    for vid, v in MOCK_FLEET.items()
}


def _record_history(vehicle: Vehicle) -> None:
    VEHICLE_HISTORY.setdefault(vehicle.id, []).append(
        VehicleHistoryEntry(
            current_soc=vehicle.current_soc,
            current_soh=vehicle.current_soh,
            status=vehicle.status,
        )
    )


@router.get("/", response_model=list[Vehicle])
def list_vehicles() -> list[Vehicle]:
    """Retrieve all vehicles in the fleet."""
    return list(MOCK_FLEET.values())


@router.get("/{vehicle_id}", response_model=Vehicle)
def get_vehicle(vehicle_id: str) -> Vehicle:
    """Retrieve details for a single vehicle."""
    vehicle = MOCK_FLEET.get(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")
    return vehicle


@router.post("/", response_model=Vehicle, status_code=201)
def create_vehicle(payload: VehicleCreate) -> Vehicle:
    """Register a new vehicle in the fleet."""
    if payload.id in MOCK_FLEET:
        raise HTTPException(status_code=409, detail=f"Vehicle '{payload.id}' already exists")
    vehicle = Vehicle(**payload.model_dump())
    MOCK_FLEET[vehicle.id] = vehicle
    _record_history(vehicle)
    return vehicle


@router.patch("/{vehicle_id}", response_model=Vehicle)
def update_vehicle(vehicle_id: str, payload: VehicleUpdate) -> Vehicle:
    """Partially update a vehicle (e.g. SOC/SOH/status)."""
    vehicle = MOCK_FLEET.get(vehicle_id)
    if not vehicle:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")

    updates = payload.model_dump(exclude_unset=True)
    updated = vehicle.model_copy(update=updates)
    MOCK_FLEET[vehicle_id] = updated

    if {"current_soc", "current_soh", "status"} & updates.keys():
        _record_history(updated)

    return updated


@router.delete("/{vehicle_id}", status_code=204)
def delete_vehicle(vehicle_id: str) -> None:
    """Remove/retire a vehicle from the fleet."""
    if vehicle_id not in MOCK_FLEET:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")
    del MOCK_FLEET[vehicle_id]
    VEHICLE_HISTORY.pop(vehicle_id, None)


@router.get("/{vehicle_id}/history", response_model=list[VehicleHistoryEntry])
def get_vehicle_history(vehicle_id: str) -> list[VehicleHistoryEntry]:
    """Retrieve SOC/SOH/status history for a vehicle."""
    if vehicle_id not in MOCK_FLEET:
        raise HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")
    return VEHICLE_HISTORY.get(vehicle_id, [])
