"""Restart and failed-write checks using isolated SQLite files."""

import json
import sqlite3
import unittest
from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.api import simulation
from app.core import fleet_state, persistence
from app.core.config import settings
from app.main import app


class PersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(Path(self.temp.name) / "nested" / "fleet.sqlite3")
        self.path_patch = patch.object(settings, "DATABASE_PATH", self.path)
        self.path_patch.start()
        self.addCleanup(self.path_patch.stop)
        self.stores = (
            fleet_state.MOCK_FLEET,
            fleet_state.VEHICLE_HISTORY,
            fleet_state.LATEST_TELEMETRY,
            fleet_state.TELEMETRY_HISTORY,
        )
        self.saved = [deepcopy(store) for store in self.stores]
        self.history = list(simulation.SIMULATION_HISTORY)
        self.addCleanup(self.restore_cache)
        self.vehicle = {
            "id": "PERSIST-1",
            "name": "Persistence test",
            "model": "Test EV",
            "battery_capacity_kwh": 75,
            "baseline_efficiency_wh_km": 160,
            "current_soc": 80,
            "current_soh": 95,
            "cycle_count": 700,
        }
        self.route = {"vehicle_id": "PERSIST-1", "route_distance_km": 50}

    def restore_cache(self):
        with fleet_state.LOCK:
            for store, saved in zip(self.stores, self.saved, strict=True):
                store.clear()
                store.update(saved)
            simulation.SIMULATION_HISTORY[:] = self.history

    def forget_cache(self):
        for store in self.stores:
            store.clear()
        simulation.SIMULATION_HISTORY.clear()

    def event(self, soc=60, timestamp="2020-01-01T12:00:00Z"):
        return {
            "vehicle_id": self.vehicle["id"],
            "timestamp": timestamp,
            "soc": soc,
            "soh": 94,
            "speed_kph": 0,
            "odometer_km": 1000,
            "ambient_temp_c": 25,
            "pack_temp_c": 25,
        }

    def test_nonfinite_inputs_are_rejected_without_changes_and_restart_succeeds(self):
        route_fields = (
            "ambient_temp_c",
            "route_distance_km",
            "elevation_gain_m",
            "elevation_loss_m",
            "payload_kg",
            "reserve_soc_target_pct",
        )
        vehicle_fields = (
            "battery_capacity_kwh",
            "baseline_efficiency_wh_km",
            "curb_mass_kg",
            "regen_efficiency",
            "current_soc",
            "current_soh",
            "cycle_count",
            "avg_dod_pct",
            "fast_charge_share_pct",
            "thermal_stress_index",
        )
        telemetry_fields = (
            "soc",
            "soh",
            "speed_kph",
            "odometer_km",
            "ambient_temp_c",
            "pack_temp_c",
            "latitude",
            "longitude",
        )
        requests = (
            ("POST", "/api/simulation/run", self.route, route_fields),
            (
                "POST",
                "/api/simulation/batch",
                {
                    "vehicle_ids": ["PERSIST-1"],
                    "route_distance_km": 50,
                },
                route_fields,
            ),
            (
                "POST",
                "/api/simulation/compare",
                {
                    **self.route,
                    "configs": [{"label": "Normal"}, {"label": "Eco"}],
                },
                route_fields,
            ),
            ("POST", "/api/vehicles/", {**self.vehicle, "id": "INVALID"}, vehicle_fields),
            ("PATCH", "/api/vehicles/PERSIST-1", {}, vehicle_fields),
            ("POST", "/api/telemetry/ingest", self.event(), telemetry_fields),
            ("POST", "/api/telemetry/batch", self.event(), telemetry_fields),
        )
        paths = (
            "/api/vehicles/",
            "/api/vehicles/PERSIST-1/history",
            "/api/telemetry/PERSIST-1/latest",
            "/api/telemetry/PERSIST-1/history",
            "/api/simulation/history",
        )
        with TestClient(app, raise_server_exceptions=False) as client:
            self.assertEqual(client.post("/api/vehicles/", json=self.vehicle).status_code, 201)
            self.assertEqual(client.post("/api/simulation/run", json=self.route).status_code, 200)
            expected = {path: client.get(path).json() for path in paths}
            persisted = list(persistence.connection.iterdump())
            for method, path, base, fields in requests:
                for field in fields:
                    for value in ("NaN", "Infinity", "-Infinity", "1e309", "-1e309"):
                        payload = {**base, field: value}
                        if path == "/api/telemetry/batch":
                            payload = {"events": [self.event(), payload]}
                        for raw in (False, True):
                            content = json.dumps(payload)
                            if raw:
                                content = content.replace(json.dumps(value), value)
                            response = client.request(
                                method,
                                path,
                                content=content,
                                headers={"Content-Type": "application/json"},
                            )
                            self.assertEqual(
                                response.status_code, 422, (method, path, field, value, raw)
                            )
                            self.assertIn(field, response.json()["detail"][0]["loc"])
            self.assertEqual(list(persistence.connection.iterdump()), persisted)
            for path, value in expected.items():
                self.assertEqual(client.get(path).json(), value)
        self.forget_cache()
        with TestClient(app) as client:
            for path, value in expected.items():
                self.assertEqual(client.get(path).json(), value)

    def test_finite_temperatures_and_nullable_fields_survive_restart(self):
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/vehicles/", json=self.vehicle).status_code, 201)
            self.assertEqual(
                client.patch("/api/vehicles/PERSIST-1", json={"avg_dod_pct": None}).status_code,
                200,
            )
            event = {**self.event(), "ambient_temp_c": -10, "pack_temp_c": 0, "latitude": None}
            self.assertEqual(client.post("/api/telemetry/ingest", json=event).status_code, 200)
            self.assertEqual(
                client.post(
                    "/api/simulation/run", json={**self.route, "ambient_temp_c": -10}
                ).status_code,
                200,
            )
        self.forget_cache()
        with TestClient(app) as client:
            self.assertIsNone(client.get("/api/vehicles/PERSIST-1").json()["avg_dod_pct"])
            telemetry = client.get("/api/telemetry/PERSIST-1/latest").json()["data"]
            self.assertEqual(telemetry["ambient_temp_c"], -10)
            self.assertEqual(telemetry["pack_temp_c"], 0)
            self.assertIsNone(telemetry["latitude"])
            self.assertEqual(
                client.get("/api/simulation/history").json()[0]["request"]["ambient_temp_c"], -10
            )

    def test_restart_preserves_state_ordering_histories_and_all_simulation_modes(self):
        with TestClient(app) as client:
            self.assertEqual(client.post("/api/vehicles/", json=self.vehicle).status_code, 201)
            for event in (
                self.event(70),
                self.event(20, "2020-01-01T11:00:00Z"),
                self.event(65),
            ):
                self.assertEqual(client.post("/api/telemetry/ingest", json=event).status_code, 200)
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json()["current_soc"], 65)
            self.assertEqual(
                client.patch("/api/vehicles/PERSIST-1", json={"current_soc": 72}).status_code,
                200,
            )
            self.assertEqual(client.post("/api/simulation/run", json=self.route).status_code, 200)
            self.assertEqual(
                client.post(
                    "/api/simulation/batch",
                    json={"vehicle_ids": ["PERSIST-1"], "route_distance_km": 50},
                ).status_code,
                200,
            )
            self.assertEqual(
                client.post(
                    "/api/simulation/compare",
                    json={
                        **self.route,
                        "configs": [{"label": "Normal"}, {"label": "Eco", "driving_style": "ECO"}],
                    },
                ).status_code,
                200,
            )
            paths = (
                "/api/vehicles/",
                "/api/vehicles/PERSIST-1/history",
                "/api/telemetry/PERSIST-1/latest",
                "/api/telemetry/PERSIST-1/history",
                "/api/simulation/history",
            )
            expected = {path: client.get(path).json() for path in paths}
            self.assertEqual(len(expected["/api/simulation/history"]), 4)
        self.forget_cache()
        with TestClient(app) as client:
            for path, value in expected.items():
                self.assertEqual(client.get(path).json(), value)
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json()["state_source"], "manual")
            latest = client.get("/api/telemetry/PERSIST-1/latest").json()["data"]
            self.assertEqual(latest["soc"], 65)
            self.assertEqual(
                client.post("/api/telemetry/ingest", json=self.event(5)).status_code, 200
            )
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json()["current_soc"], 72)

    def test_deleted_vehicle_stays_deleted_and_recreation_keeps_original_simulation(self):
        with TestClient(app) as client:
            client.post("/api/vehicles/", json=self.vehicle)
            client.post("/api/telemetry/ingest", json=self.event())
            client.post("/api/simulation/run", json=self.route)
            original = client.get("/api/simulation/history").json()[0]
            self.assertEqual(client.delete("/api/vehicles/PERSIST-1").status_code, 204)
        self.forget_cache()
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").status_code, 404)
            self.assertEqual(client.post("/api/vehicles/", json=self.vehicle).status_code, 201)
            self.assertIsNone(client.get("/api/telemetry/PERSIST-1/latest").json()["data"])
            self.assertEqual(client.get("/api/telemetry/PERSIST-1/history").json(), [])
            self.assertEqual(len(client.get("/api/vehicles/PERSIST-1/history").json()), 1)
            self.assertEqual(client.get(f"/api/simulation/{original['id']}").json(), original)
        self.forget_cache()
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json()["current_soc"], 80)
            self.assertEqual(client.get("/api/telemetry/PERSIST-1/history").json(), [])
            self.assertEqual(client.get(f"/api/simulation/{original['id']}").json(), original)

    def test_empty_fleet_is_not_reseeded(self):
        with TestClient(app) as client:
            for vehicle in client.get("/api/vehicles/").json():
                self.assertEqual(client.delete(f"/api/vehicles/{vehicle['id']}").status_code, 204)
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/vehicles/").json(), [])

    def test_failed_writes_leave_no_memory_or_persisted_changes(self):
        with TestClient(app) as client:
            client.post("/api/vehicles/", json=self.vehicle)
            expected = client.get("/api/vehicles/PERSIST-1").json()
            persistence.connection.execute("PRAGMA query_only = ON")
            requests = (
                ("POST", "/api/vehicles/", {**self.vehicle, "id": "FAILED"}),
                ("PATCH", "/api/vehicles/PERSIST-1", {"current_soc": 10}),
                ("POST", "/api/telemetry/ingest", self.event()),
                ("DELETE", "/api/vehicles/PERSIST-1", None),
                ("POST", "/api/simulation/run", self.route),
            )
            with self.assertLogs("app.main", level="ERROR"):
                for method, path, payload in requests:
                    response = client.request(method, path, json=payload)
                    self.assertEqual(response.status_code, 503)
                    self.assertEqual(response.json(), {"detail": "Fleet storage unavailable"})
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json(), expected)
            self.assertEqual(client.get("/api/vehicles/FAILED").status_code, 404)
            self.assertEqual(client.get("/api/telemetry/PERSIST-1/history").json(), [])
            self.assertEqual(client.get("/api/simulation/history").json(), [])
        self.forget_cache()
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json(), expected)
            self.assertEqual(client.get("/api/vehicles/FAILED").status_code, 404)
            self.assertEqual(len(client.get("/api/vehicles/PERSIST-1/history").json()), 1)
            self.assertEqual(client.get("/api/telemetry/PERSIST-1/history").json(), [])
            self.assertEqual(client.get("/api/simulation/history").json(), [])

    def test_telemetry_transaction_rolls_back_vehicle_and_history_when_event_write_fails(self):
        with TestClient(app) as client:
            client.post("/api/vehicles/", json=self.vehicle)
            expected = client.get("/api/vehicles/PERSIST-1").json()
            persistence.connection.execute(
                "CREATE TRIGGER reject_event BEFORE INSERT ON telemetry "
                "BEGIN SELECT RAISE(ABORT, 'test write failure'); END"
            )
            with self.assertLogs("app.main", level="ERROR"):
                self.assertEqual(
                    client.post("/api/telemetry/ingest", json=self.event()).status_code, 503
                )
        self.forget_cache()
        with TestClient(app) as client:
            self.assertEqual(client.get("/api/vehicles/PERSIST-1").json(), expected)
            self.assertEqual(len(client.get("/api/vehicles/PERSIST-1/history").json()), 1)
            self.assertEqual(client.get("/api/telemetry/PERSIST-1/history").json(), [])

    def test_unknown_database_version_fails_startup_without_overwriting(self):
        with TestClient(app):
            pass
        with sqlite3.connect(self.path) as db:
            db.execute("PRAGMA user_version = 999")
        with self.assertRaisesRegex(RuntimeError, "Unsupported fleet database version"):
            with TestClient(app):
                pass
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute("PRAGMA user_version").fetchone()[0], 999)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0], 6)


if __name__ == "__main__":
    unittest.main()
