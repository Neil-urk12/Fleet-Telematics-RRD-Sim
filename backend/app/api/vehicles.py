from fastapi import APIRouter, HTTPException
from pydantic import ValidationError

from app.core import fleet_state
from app.schemas.vehicle import Vehicle, VehicleCreate, VehicleHistoryEntry, VehicleUpdate

router = APIRouter()


def _not_found(vehicle_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")


@router.get("/", response_model=list[Vehicle])
def list_vehicles() -> list[Vehicle]:
    return fleet_state.list_vehicles()


@router.get("/{vehicle_id}", response_model=Vehicle)
def get_vehicle(vehicle_id: str) -> Vehicle:
    try:
        return fleet_state.get_vehicle(vehicle_id)
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc


@router.post("/", response_model=Vehicle, status_code=201)
def create_vehicle(payload: VehicleCreate) -> Vehicle:
    try:
        return fleet_state.create_vehicle(payload)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.patch("/{vehicle_id}", response_model=Vehicle)
def update_vehicle(vehicle_id: str, payload: VehicleUpdate) -> Vehicle:
    try:
        return fleet_state.update_vehicle(vehicle_id, payload)
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
