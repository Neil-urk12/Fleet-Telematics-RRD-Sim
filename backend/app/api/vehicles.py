from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.core import fleet_state
from app.core.battery_history import assess_battery_history
from app.schemas.vehicle import (
    Vehicle,
    VehicleCreate,
    VehicleHistoryEntry,
    VehicleUpdate,
    VehicleWithHistory,
)

router = APIRouter()


def _not_found(vehicle_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")


def _with_history(vehicle: Vehicle) -> VehicleWithHistory:
    return VehicleWithHistory(
        **vehicle.model_dump(), battery_history=assess_battery_history(vehicle)
    )


@router.get("/", response_model=list[VehicleWithHistory])
def list_vehicles() -> list[VehicleWithHistory]:
    return [_with_history(vehicle) for vehicle in fleet_state.list_vehicles()]


@router.get("/{vehicle_id}", response_model=VehicleWithHistory)
def get_vehicle(vehicle_id: str) -> VehicleWithHistory:
    try:
        return _with_history(fleet_state.get_vehicle(vehicle_id))
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc


@router.post("/", response_model=VehicleWithHistory, status_code=201)
def create_vehicle(payload: VehicleCreate) -> VehicleWithHistory:
    try:
        return _with_history(fleet_state.create_vehicle(payload))
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/{vehicle_id}", response_model=VehicleWithHistory)
def update_vehicle(vehicle_id: str, payload: VehicleUpdate) -> VehicleWithHistory:
    try:
        return _with_history(fleet_state.update_vehicle(vehicle_id, payload))
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="Invalid vehicle update") from exc
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.delete("/{vehicle_id}", status_code=204)
def delete_vehicle(vehicle_id: str) -> None:
    try:
        fleet_state.delete_vehicle(vehicle_id)
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc


@router.get("/{vehicle_id}/history", response_model=list[VehicleHistoryEntry])
def get_vehicle_history(vehicle_id: str) -> list[VehicleHistoryEntry]:
    try:
        return fleet_state.get_vehicle_history(vehicle_id)
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc
