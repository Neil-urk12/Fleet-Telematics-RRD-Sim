"""Shared fleet cache with SQLite writes committed before in-memory updates."""

from datetime import UTC, datetime
from threading import RLock

from app.core import persistence
from app.schemas.telemetry import TelemetryEvent
from app.schemas.vehicle import Vehicle, VehicleCreate, VehicleHistoryEntry, VehicleUpdate

# shortcut: caches are process-local; use database-backed reads before adding workers.
LOCK = RLock()

MOCK_FLEET: dict[str, Vehicle] = {
    # Masses and operating histories below are illustrative demo profiles,
    # not verified OEM specifications or measured fleet data.
    "EV-001": Vehicle(
        id="EV-001",
        name="Alpha",
        model="Tesla Model 3",
        battery_capacity_kwh=75.0,
        baseline_efficiency_wh_km=160.0,
        curb_mass_kg=1800.0,
        cycle_count=420,
        avg_dod_pct=62.0,
        fast_charge_share_pct=12.0,
        thermal_stress_index=22.0,
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
        cycle_count=700,
        avg_dod_pct=68.0,
        fast_charge_share_pct=18.0,
        thermal_stress_index=32.0,
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
        cycle_count=1150,
        avg_dod_pct=78.0,
        fast_charge_share_pct=30.0,
        thermal_stress_index=50.0,
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
        cycle_count=310,
        avg_dod_pct=55.0,
        fast_charge_share_pct=8.0,
        thermal_stress_index=18.0,
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
        cycle_count=1610,
        avg_dod_pct=88.0,
        fast_charge_share_pct=58.0,
        thermal_stress_index=71.0,
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
        cycle_count=760,
        avg_dod_pct=68.0,
        fast_charge_share_pct=21.0,
        thermal_stress_index=36.0,
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


DEMO_FLEET = list(MOCK_FLEET.values())


def restore() -> None:
    """Validate all persisted records before replacing the in-process snapshot."""
    db = persistence.connection
    if db is None:
        raise RuntimeError("Fleet database is not open")
    vehicles = {
        vehicle.id: vehicle
        for (payload,) in db.execute("SELECT payload FROM vehicles ORDER BY rowid")
        for vehicle in [Vehicle.model_validate_json(payload)]
    }
    histories: dict[str, list[VehicleHistoryEntry]] = {}
    for vehicle_id, payload in db.execute(
        "SELECT vehicle_id, payload FROM vehicle_history ORDER BY id"
    ):
        histories.setdefault(vehicle_id, []).append(
            VehicleHistoryEntry.model_validate_json(payload)
        )
    events: dict[str, list[TelemetryEvent]] = {}
    latest: dict[str, TelemetryEvent] = {}
    for vehicle_id, payload in db.execute("SELECT vehicle_id, payload FROM telemetry ORDER BY id"):
        event = TelemetryEvent.model_validate_json(payload)
        events.setdefault(vehicle_id, []).append(event)
        if vehicle_id not in latest or event.timestamp >= latest[vehicle_id].timestamp:
            latest[vehicle_id] = event
    with LOCK:
        for store, restored in (
            (MOCK_FLEET, vehicles),
            (VEHICLE_HISTORY, histories),
            (LATEST_TELEMETRY, latest),
            (TELEMETRY_HISTORY, events),
        ):
            store.clear()
            store.update(restored)


def _history_entry(vehicle: Vehicle, timestamp: datetime | None = None) -> VehicleHistoryEntry:
    return VehicleHistoryEntry(
        timestamp=timestamp or datetime.now(UTC),
        current_soc=vehicle.current_soc,
        current_soh=vehicle.current_soh,
        status=vehicle.status,
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
        entry = _history_entry(vehicle)
        persistence.save_vehicle(vehicle, entry)
        MOCK_FLEET[vehicle.id] = vehicle
        VEHICLE_HISTORY.setdefault(vehicle.id, []).append(entry)
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
        entry = (
            _history_entry(updated)
            if {"current_soc", "current_soh", "status"} & updates.keys()
            else None
        )
        persistence.save_vehicle(updated, entry)
        MOCK_FLEET[vehicle_id] = updated
        if entry is not None:
            VEHICLE_HISTORY.setdefault(vehicle_id, []).append(entry)
        return updated.model_copy(deep=True)


def delete_vehicle(vehicle_id: str) -> None:
    with LOCK:
        if vehicle_id not in MOCK_FLEET:
            raise KeyError(vehicle_id)
        persistence.delete_vehicle(vehicle_id)
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
        updated = vehicle
        entry = None
        if vehicle.state_timestamp is None or event.timestamp >= vehicle.state_timestamp:
            updated = vehicle.model_copy(
                update={
                    "current_soc": event.soc,
                    "current_soh": event.soh,
                    "state_source": "telemetry",
                    "state_timestamp": event.timestamp,
                }
            )
            entry = _history_entry(updated, event.timestamp)
        persistence.save_vehicle(updated, entry, event)
        if latest is None or event.timestamp >= latest.timestamp:
            LATEST_TELEMETRY[event.vehicle_id] = event
        TELEMETRY_HISTORY.setdefault(event.vehicle_id, []).append(event)
        MOCK_FLEET[event.vehicle_id] = updated
        if entry is not None:
            VEHICLE_HISTORY.setdefault(event.vehicle_id, []).append(entry)


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
