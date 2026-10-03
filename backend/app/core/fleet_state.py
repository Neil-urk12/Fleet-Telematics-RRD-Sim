"""Process-local fleet state shared by vehicle, telemetry, and simulation routes."""

from datetime import UTC, datetime
from threading import RLock

from app.schemas.telemetry import TelemetryEvent
from app.schemas.vehicle import Vehicle, VehicleCreate, VehicleHistoryEntry, VehicleUpdate

LOCK = RLock()

MOCK_FLEET: dict[str, Vehicle] = {
    # Masses below are illustrative demo profiles, not verified OEM specifications.
    "EV-001": Vehicle(
        id="EV-001",
        name="Alpha",
        model="Tesla Model 3",
        battery_capacity_kwh=75.0,
        baseline_efficiency_wh_km=160.0,
        curb_mass_kg=1800.0,
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
        curb_mass_kg=3200.0,
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
        curb_mass_kg=3000.0,
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
        curb_mass_kg=2000.0,
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
        curb_mass_kg=4000.0,
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
        curb_mass_kg=3200.0,
        current_soc=74.6,
        current_soh=93.8,
        status="AVAILABLE",
    ),
}

VEHICLE_HISTORY: dict[str, list[VehicleHistoryEntry]] = {
    vid: [
        VehicleHistoryEntry(current_soc=v.current_soc, current_soh=v.current_soh, status=v.status)
    ]
    for vid, v in MOCK_FLEET.items()
}
LATEST_TELEMETRY: dict[str, TelemetryEvent] = {}
TELEMETRY_HISTORY: dict[str, list[TelemetryEvent]] = {}


def _record_history(vehicle: Vehicle, timestamp: datetime | None = None) -> None:
    VEHICLE_HISTORY.setdefault(vehicle.id, []).append(
        VehicleHistoryEntry(
            timestamp=timestamp or datetime.now(UTC),
            current_soc=vehicle.current_soc,
            current_soh=vehicle.current_soh,
            status=vehicle.status,
        )
    )


def get_vehicle(vehicle_id: str) -> Vehicle:
    with LOCK:
        return MOCK_FLEET[vehicle_id].model_copy(deep=True)


def list_vehicles() -> list[Vehicle]:
    with LOCK:
        return [vehicle.model_copy(deep=True) for vehicle in MOCK_FLEET.values()]


def create_vehicle(payload: VehicleCreate) -> Vehicle:
    with LOCK:
        if payload.id in MOCK_FLEET:
            raise ValueError(f"Vehicle '{payload.id}' already exists")
        vehicle = Vehicle(**payload.model_dump())
        MOCK_FLEET[vehicle.id] = vehicle
        _record_history(vehicle)
        return vehicle.model_copy(deep=True)


def update_vehicle(vehicle_id: str, payload: VehicleUpdate) -> Vehicle:
    with LOCK:
        vehicle = MOCK_FLEET[vehicle_id]
        updates = payload.model_dump(exclude_unset=True)
        if {"current_soc", "current_soh"} & updates.keys():
            timestamp = datetime.now(UTC)
            if vehicle.state_timestamp is not None and timestamp < vehicle.state_timestamp:
                raise ValueError("Manual battery update is older than the current battery state")
            updates.update(state_source="manual", state_timestamp=timestamp)
        # Validate the complete result: model_copy(update=...) would bypass validation.
        updated = Vehicle.model_validate({**vehicle.model_dump(), **updates})
        MOCK_FLEET[vehicle_id] = updated
        if {"current_soc", "current_soh", "status"} & updates.keys():
            _record_history(updated)
        return updated.model_copy(deep=True)


def delete_vehicle(vehicle_id: str) -> None:
    with LOCK:
        del MOCK_FLEET[vehicle_id]
        VEHICLE_HISTORY.pop(vehicle_id, None)
        LATEST_TELEMETRY.pop(vehicle_id, None)
        TELEMETRY_HISTORY.pop(vehicle_id, None)


def get_vehicle_history(vehicle_id: str) -> list[VehicleHistoryEntry]:
    with LOCK:
        if vehicle_id not in MOCK_FLEET:
            raise KeyError(vehicle_id)
        return [entry.model_copy(deep=True) for entry in VEHICLE_HISTORY.get(vehicle_id, [])]


def store_event(event: TelemetryEvent) -> None:
    with LOCK:
        vehicle = MOCK_FLEET[event.vehicle_id]
        event = event.model_copy(deep=True)
        latest = LATEST_TELEMETRY.get(event.vehicle_id)
        if latest is None or event.timestamp >= latest.timestamp:
            LATEST_TELEMETRY[event.vehicle_id] = event
        TELEMETRY_HISTORY.setdefault(event.vehicle_id, []).append(event)
        if vehicle.state_timestamp is None or event.timestamp >= vehicle.state_timestamp:
            updated = vehicle.model_copy(
                update={
                    "current_soc": event.soc,
                    "current_soh": event.soh,
                    "state_source": "telemetry",
                    "state_timestamp": event.timestamp,
                }
            )
            MOCK_FLEET[event.vehicle_id] = updated
            _record_history(updated, event.timestamp)


def get_latest_telemetry(vehicle_id: str) -> TelemetryEvent | None:
    with LOCK:
        if vehicle_id not in MOCK_FLEET:
            raise KeyError(vehicle_id)
        event = LATEST_TELEMETRY.get(vehicle_id)
        return event.model_copy(deep=True) if event is not None else None


def get_fleet_latest_telemetry() -> dict[str, TelemetryEvent]:
    with LOCK:
        return {key: event.model_copy(deep=True) for key, event in LATEST_TELEMETRY.items()}


def get_telemetry_history(vehicle_id: str) -> list[TelemetryEvent]:
    with LOCK:
        if vehicle_id not in MOCK_FLEET:
            raise KeyError(vehicle_id)
        return [event.model_copy(deep=True) for event in TELEMETRY_HISTORY.get(vehicle_id, [])]
