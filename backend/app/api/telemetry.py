from fastapi import APIRouter, HTTPException

from app.core import fleet_state
from app.schemas.telemetry import (
    BatchTelemetryRequest,
    BatchTelemetryResponse,
    BatchTelemetryResult,
    FleetTelemetryResponse,
    TelemetryEvent,
    TelemetryResponse,
)

router = APIRouter()


def _not_found(vehicle_id: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"Vehicle '{vehicle_id}' not found")


@router.post("/ingest", response_model=TelemetryResponse)
def ingest_telemetry(event: TelemetryEvent) -> TelemetryResponse:
    """Ingest a single telemetry snapshot for a vehicle."""
    try:
        fleet_state.store_event(event)
    except KeyError as exc:
        raise _not_found(event.vehicle_id) from exc
    return TelemetryResponse(
        success=True,
        message=f"Telemetry ingested for {event.vehicle_id}",
        data=event,
    )


@router.post("/batch", response_model=BatchTelemetryResponse)
def ingest_batch_telemetry(payload: BatchTelemetryRequest) -> BatchTelemetryResponse:
    """Ingest telemetry snapshots from multiple vehicles in one call."""
    results: list[BatchTelemetryResult] = []
    for event in payload.events:
        try:
            fleet_state.store_event(event)
        except KeyError:
            results.append(
                BatchTelemetryResult(
                    vehicle_id=event.vehicle_id,
                    success=False,
                    message=f"Vehicle '{event.vehicle_id}' not found",
                )
            )
            continue
        results.append(
            BatchTelemetryResult(
                vehicle_id=event.vehicle_id,
                success=True,
                message="Ingested",
            )
        )
    return BatchTelemetryResponse(results=results)


@router.get("/fleet/latest", response_model=FleetTelemetryResponse)
def get_fleet_latest_telemetry() -> FleetTelemetryResponse:
    """Retrieve the latest telemetry snapshot for every vehicle that has reported in."""
    events = fleet_state.get_fleet_latest_telemetry()
    return FleetTelemetryResponse(
        success=True,
        message=f"Retrieved latest telemetry for {len(events)} vehicle(s)",
        data=events,
    )


@router.get("/{vehicle_id}/latest", response_model=TelemetryResponse)
def get_latest_telemetry(vehicle_id: str) -> TelemetryResponse:
    """Retrieve the latest telemetry recorded for a vehicle."""
    try:
        event = fleet_state.get_latest_telemetry(vehicle_id)
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc
    return TelemetryResponse(
        success=True,
        message="Telemetry retrieved"
        if event
        else "No telemetry recorded; using vehicle battery state",
        data=event,
    )


@router.get("/{vehicle_id}/history", response_model=list[TelemetryEvent])
def get_telemetry_history(vehicle_id: str) -> list[TelemetryEvent]:
    """Retrieve full telemetry history for a vehicle (empty list if none ingested)."""
    try:
        return fleet_state.get_telemetry_history(vehicle_id)
    except KeyError as exc:
        raise _not_found(vehicle_id) from exc
