"""SQLite writes are committed before the process-local state is changed."""

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.schemas.simulation import SimulationRecord
from app.schemas.telemetry import TelemetryEvent
from app.schemas.vehicle import Vehicle, VehicleHistoryEntry

connection: sqlite3.Connection | None = None


@contextmanager
def open_database(path: str, seed: list[Vehicle]):
    global connection
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, check_same_thread=False)
    try:
        db.execute("PRAGMA foreign_keys = ON")
        version = db.execute("PRAGMA user_version").fetchone()[0]
        if version not in (0, 1):
            raise RuntimeError(f"Unsupported fleet database version: {version}")
        if version == 0:
            with db:
                db.execute("BEGIN")
                db.execute("CREATE TABLE vehicles (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
                db.execute(
                    "CREATE TABLE vehicle_history (id INTEGER PRIMARY KEY, "
                    "vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, "
                    "payload TEXT NOT NULL)"
                )
                db.execute(
                    "CREATE TABLE telemetry (id INTEGER PRIMARY KEY, "
                    "vehicle_id TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE, "
                    "payload TEXT NOT NULL)"
                )
                db.execute("CREATE TABLE simulations (id TEXT PRIMARY KEY, payload TEXT NOT NULL)")
                for vehicle in seed:
                    db.execute(
                        "INSERT INTO vehicles VALUES (?, ?)",
                        (vehicle.id, vehicle.model_dump_json()),
                    )
                    entry = VehicleHistoryEntry(
                        current_soc=vehicle.current_soc,
                        current_soh=vehicle.current_soh,
                        status=vehicle.status,
                    )
                    db.execute(
                        "INSERT INTO vehicle_history (vehicle_id, payload) VALUES (?, ?)",
                        (vehicle.id, entry.model_dump_json()),
                    )
                db.execute("PRAGMA user_version = 1")
        connection = db
        yield db
    finally:
        connection = None
        db.close()


def save_vehicle(
    vehicle: Vehicle,
    entry: VehicleHistoryEntry | None = None,
    event: TelemetryEvent | None = None,
) -> None:
    if connection is None:
        return
    with connection:
        connection.execute(
            "INSERT INTO vehicles VALUES (?, ?) "
            "ON CONFLICT(id) DO UPDATE SET payload = excluded.payload",
            (vehicle.id, vehicle.model_dump_json()),
        )
        if entry is not None:
            connection.execute(
                "INSERT INTO vehicle_history (vehicle_id, payload) VALUES (?, ?)",
                (vehicle.id, entry.model_dump_json()),
            )
        if event is not None:
            connection.execute(
                "INSERT INTO telemetry (vehicle_id, payload) VALUES (?, ?)",
                (vehicle.id, event.model_dump_json()),
            )


def delete_vehicle(vehicle_id: str) -> None:
    if connection is not None:
        with connection:
            connection.execute("DELETE FROM vehicles WHERE id = ?", (vehicle_id,))


def save_simulation(record: SimulationRecord) -> None:
    if connection is not None:
        with connection:
            connection.execute(
                "INSERT INTO simulations VALUES (?, ?)", (record.id, record.model_dump_json())
            )
