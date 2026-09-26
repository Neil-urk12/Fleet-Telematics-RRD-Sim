from datetime import UTC, datetime

from fastapi import APIRouter

from app.schemas.telemetry import (
    BatchTelemetryRequest,
    BatchTelemetryResponse,
    BatchTelemetryResult,
    FleetTelemetryResponse,
    TelemetryEvent,
    TelemetryResponse,
)

router = APIRouter()

# In-memory latest telemetry storage
LATEST_TELEMETRY: dict[str, TelemetryEvent] = {}

# In-memory telemetry history, keyed by vehicle id, most recent last
TELEMETRY_HISTORY: dict[str, list[TelemetryEvent]] = {}


def _store_event(event: TelemetryEvent) -> None:
    LATEST_TELEMETRY[event.vehicle_id] = event
    TELEMETRY_HISTORY.setdefault(event.vehicle_id, []).append(event)


@router.post("/ingest", response_model=TelemetryResponse)
def ingest_telemetry(event: TelemetryEvent) -> TelemetryResponse:
    """Ingest a single telemetry snapshot for a vehicle."""
    _store_event(event)
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
        _store_event(event)
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
    return FleetTelemetryResponse(
        success=True,
        message=f"Retrieved latest telemetry for {len(LATEST_TELEMETRY)} vehicle(s)",
        data=LATEST_TELEMETRY,
    )


@router.get("/{vehicle_id}/latest", response_model=TelemetryResponse)
def get_latest_telemetry(vehicle_id: str) -> TelemetryResponse:
    """Retrieve the latest telemetry recorded for a vehicle."""
    event = LATEST_TELEMETRY.get(vehicle_id)
    if not event:
        # Provide fallback/synthetic reading if none ingested yet
        event = TelemetryEvent(
            vehicle_id=vehicle_id,
            timestamp=datetime.now(UTC),
            soc=80.0,
            soh=95.0,
            speed_kph=0.0,
            odometer_km=12500.0,
            ambient_temp_c=22.0,
            pack_temp_c=25.0,
        )
    return TelemetryResponse(
        success=True,
        message="Telemetry retrieved",
        data=event,
    )


@router.get("/{vehicle_id}/history", response_model=list[TelemetryEvent])
def get_telemetry_history(vehicle_id: str) -> list[TelemetryEvent]:
    """Retrieve full telemetry history for a vehicle (empty list if none ingested)."""
    return TELEMETRY_HISTORY.get(vehicle_id, [])