"""HTTP regression tests for battery state shared by ingestion, fleet, and assessments."""

import unittest
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import simulation
from app.core import fleet_state
from app.main import app
from app.schemas.telemetry import TelemetryEvent


class CurrentStateTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        stores = (
            fleet_state.MOCK_FLEET,
            fleet_state.VEHICLE_HISTORY,
            fleet_state.LATEST_TELEMETRY,
            fleet_state.TELEMETRY_HISTORY,
        )
        with fleet_state.LOCK:
            self.stores = stores
            self.saved = [dict(store) for store in stores]
            for store in stores:
                store.clear()
        self.history = list(simulation.SIMULATION_HISTORY)
        simulation.SIMULATION_HISTORY.clear()
        for vehicle_id in ("TEST-1", "TEST-2"):
            response = self.client.post(
                "/api/vehicles/",
                json={
                    "id": vehicle_id,
                    "name": vehicle_id,
                    "model": "Test EV",
                    "battery_capacity_kwh": 75,
                    "baseline_efficiency_wh_km": 160,
                    "current_soc": 80,
                    "current_soh": 95,
                },
            )
            self.assertEqual(response.status_code, 201)
        self.route = {"vehicle_id": "TEST-1", "route_distance_km": 120}

    def tearDown(self):
        with fleet_state.LOCK:
            for store, saved in zip(self.stores, self.saved, strict=True):
                store.clear()
                store.update(saved)
        simulation.SIMULATION_HISTORY[:] = self.history
        self.client.close()

    def event(self, soc=80, soh=95, timestamp="2020-01-01T12:00:00Z", vehicle_id="TEST-1"):
        return {
            "vehicle_id": vehicle_id,
            "timestamp": timestamp,
            "soc": soc,
            "soh": soh,
            "speed_kph": 0,
            "odometer_km": 12500,
            "ambient_temp_c": 25,
            "pack_temp_c": 25,
        }

    def ingest(self, **kwargs):
        response = self.client.post("/api/telemetry/ingest", json=self.event(**kwargs))
        self.assertEqual(response.status_code, 200)
        return response.json()

    def vehicle(self):
        return self.client.get("/api/vehicles/TEST-1").json()

    def assess(self):
        response = self.client.post("/api/simulation/run", json=self.route)
        self.assertEqual(response.status_code, 200)
        return response.json()

    def test_defaults_without_fabricated_telemetry(self):
        vehicle = self.vehicle()
        self.assertEqual(vehicle["state_source"], "vehicle_defaults")
        self.assertIsNone(vehicle["state_timestamp"])
        latest = self.client.get("/api/telemetry/TEST-1/latest").json()
        self.assertIsNone(latest["data"])
        self.assertIn("No telemetry", latest["message"])
        self.assertEqual(self.client.get("/api/telemetry/fleet/latest").json()["data"], {})
        self.assertEqual(self.assess()["starting_soc_pct"], 80)
        self.assertEqual(self.assess()["state_source"], "vehicle_defaults")

    def test_telemetry_changes_fleet_and_route_decision(self):
        before = self.assess()
        self.ingest(soc=20, soh=85)
        after = self.assess()
        self.assertEqual(self.vehicle()["current_soc"], 20)
        self.assertEqual(self.vehicle()["current_soh"], 85)
        fleet = self.client.get("/api/vehicles/").json()
        self.assertEqual(next(v for v in fleet if v["id"] == "TEST-1"), self.vehicle())
        self.assertEqual(after["starting_soc_pct"], 20)
        self.assertEqual(after["starting_soh_pct"], 85)
        self.assertEqual(after["state_source"], "telemetry")
        self.assertEqual(after["state_timestamp"], self.vehicle()["state_timestamp"])
        self.assertLess(after["usable_battery_capacity_kwh"], before["usable_battery_capacity_kwh"])
        self.assertLess(after["projected_arrival_soc_pct"], before["projected_arrival_soc_pct"])
        self.assertEqual(before["risk_level"], "SAFE")
        self.assertEqual(after["risk_level"], "NOT_RECOMMENDED")
        self.assertEqual(self.vehicle()["status"], "AVAILABLE")
        self.assertEqual(self.vehicle()["battery_capacity_kwh"], 75)

    def test_older_equal_and_timezone_readings(self):
        self.ingest(soc=60)
        baseline = self.assess()
        self.ingest(soc=10, timestamp="2020-01-01T13:00:00+02:00")
        self.ingest(soc=15, timestamp="2020-01-01T11:30:00")
        self.assertEqual(self.assess(), baseline)
        self.ingest(soc=55, timestamp="2020-01-01T14:00:00+02:00")
        self.assertEqual(self.vehicle()["current_soc"], 55)
        self.assertEqual(self.vehicle()["state_timestamp"], "2020-01-01T12:00:00Z")
        events = self.client.get("/api/telemetry/TEST-1/history").json()
        self.assertEqual([e["soc"] for e in events], [60, 10, 15, 55])
        history = self.client.get("/api/vehicles/TEST-1/history").json()
        self.assertEqual([v["current_soc"] for v in history], [80, 60, 55])

    def test_manual_edit_is_a_timestamped_snapshot(self):
        self.ingest(soc=60, soh=90)
        with patch("app.core.fleet_state.datetime") as clock:
            clock.now.return_value = datetime(2020, 1, 1, 13, tzinfo=UTC)
            edited = self.client.patch("/api/vehicles/TEST-1", json={"current_soc": 50})
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json()["state_source"], "manual")
        self.assertEqual(edited.json()["current_soh"], 90)
        self.ingest(soc=10, timestamp="2020-01-01T12:30:00Z")
        self.assertEqual(self.vehicle(), edited.json())
        # Latest raw telemetry is distinct from the newer manual battery snapshot.
        self.assertEqual(self.client.get("/api/telemetry/TEST-1/latest").json()["data"]["soc"], 10)
        self.assertEqual(self.assess()["starting_soc_pct"], 50)
        self.ingest(soc=45, soh=88, timestamp="2020-01-01T13:00:00Z")
        self.assertEqual(self.vehicle()["state_source"], "telemetry")
        self.assertEqual(self.vehicle()["current_soc"], 45)

    def test_status_and_spec_edits_preserve_source(self):
        self.ingest(soc=40)
        before = self.vehicle()
        response = self.client.patch(
            "/api/vehicles/TEST-1", json={"status": "CHARGING", "name": "Renamed"}
        )
        self.assertEqual(response.status_code, 200)
        for key in ("current_soc", "current_soh", "state_source", "state_timestamp"):
            self.assertEqual(response.json()[key], before[key])
        response = self.client.patch("/api/vehicles/TEST-1", json={"current_soc": None})
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.vehicle()["current_soc"], 40)

    def test_manual_edit_cannot_regress_a_newer_state(self):
        self.ingest(timestamp="2020-01-01T12:00:00Z")
        with patch("app.core.fleet_state.datetime") as clock:
            clock.now.return_value = datetime(2020, 1, 1, 11, tzinfo=UTC)
            response = self.client.patch("/api/vehicles/TEST-1", json={"current_soc": 10})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.vehicle()["current_soc"], 80)

    def test_single_batch_and_comparison_use_same_state(self):
        self.ingest(soc=35, soh=89)
        single = self.assess()
        batch = self.client.post(
            "/api/simulation/batch", json={"vehicle_ids": ["TEST-1"], "route_distance_km": 120}
        )
        self.assertEqual(batch.status_code, 200)
        self.assertEqual(batch.json()["results"][0]["response"], single)
        compare = self.client.post(
            "/api/simulation/compare",
            json={**self.route, "configs": [{"label": "A"}, {"label": "B"}]},
        )
        self.assertEqual(compare.status_code, 200)
        self.assertTrue(all(r["response"] == single for r in compare.json()["results"]))

    def test_comparison_keeps_one_snapshot_during_ingestion(self):
        self.ingest(soc=60)
        calculate = simulation.calculate_simulation

        def ingest_during_calculation(req, vehicle):
            fleet_state.store_event(
                TelemetryEvent(**self.event(soc=20, timestamp="2020-01-01T13:00:00Z"))
            )
            return calculate(req, vehicle)

        with patch(
            "app.api.simulation.calculate_simulation", side_effect=ingest_during_calculation
        ):
            response = self.client.post(
                "/api/simulation/compare",
                json={**self.route, "configs": [{"label": "A"}, {"label": "B"}]},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            [r["response"]["starting_soc_pct"] for r in response.json()["results"]], [60, 60]
        )
        self.assertEqual(self.vehicle()["current_soc"], 20)

    def test_invalid_batch_has_no_side_effects(self):
        for events in (
            [],
            [self.event(soc=30), self.event(soc=101)],
            [self.event(), {"vehicle_id": "TEST-2"}],
        ):
            response = self.client.post("/api/telemetry/batch", json={"events": events})
            self.assertEqual(response.status_code, 422)
            self.assertEqual(self.vehicle()["current_soc"], 80)
            self.assertEqual(self.client.get("/api/telemetry/TEST-1/history").json(), [])

    def test_future_telemetry_is_rejected_without_freezing_battery_updates(self):
        before = self.vehicle()
        history = self.client.get("/api/vehicles/TEST-1/history").json()
        for timestamp in ("2099-01-01T00:00:00Z", "2099-01-01T08:00:00+08:00", "2099-01-01"):
            response = self.client.post(
                "/api/telemetry/ingest", json=self.event(soc=20, timestamp=timestamp)
            )
            self.assertEqual(response.status_code, 422)
            self.assertEqual(self.vehicle(), before)
            self.assertEqual(self.client.get("/api/telemetry/TEST-1/history").json(), [])
            self.assertIsNone(self.client.get("/api/telemetry/TEST-1/latest").json()["data"])
            self.assertEqual(self.client.get("/api/vehicles/TEST-1/history").json(), history)
        self.ingest(soc=60, timestamp=datetime.now(UTC).isoformat())
        self.assertEqual(self.vehicle()["current_soc"], 60)
        response = self.client.patch("/api/vehicles/TEST-1", json={"current_soc": 50})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.assess()["starting_soc_pct"], 50)

    def test_future_batch_has_no_side_effects(self):
        response = self.client.post(
            "/api/telemetry/batch",
            json={"events": [self.event(soc=30), self.event(timestamp="2099-01-01T00:00:00Z")]},
        )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.vehicle()["current_soc"], 80)
        self.assertEqual(self.client.get("/api/telemetry/TEST-1/history").json(), [])
        self.assertEqual(self.client.get("/api/telemetry/fleet/latest").json()["data"], {})
        self.assertEqual(len(self.client.get("/api/vehicles/TEST-1/history").json()), 1)

    def test_timestamp_clock_skew_boundary(self):
        now = datetime(2026, 1, 1, tzinfo=UTC)
        with patch("app.schemas.telemetry.datetime") as clock:
            clock.now.return_value = now
            for timestamp in (
                "2026-01-01T00:05:00Z",
                "2026-01-01T08:05:00+08:00",
                "2026-01-01T00:05:00",
            ):
                event = TelemetryEvent(**self.event(timestamp=timestamp))
                self.assertEqual(event.timestamp, now + timedelta(minutes=5))
            with self.assertRaises(ValidationError):
                TelemetryEvent(**self.event(timestamp="2026-01-01T00:05:00.000001Z"))

    def test_unknown_ids_and_partial_batch(self):
        for path in (
            "/api/vehicles/unknown",
            "/api/telemetry/unknown/latest",
            "/api/telemetry/unknown/history",
        ):
            self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(
            self.client.post(
                "/api/telemetry/ingest", json=self.event(vehicle_id="unknown")
            ).status_code,
            404,
        )
        response = self.client.post(
            "/api/telemetry/batch",
            json={
                "events": [
                    self.event(soc=30),
                    self.event(vehicle_id="unknown"),
                    self.event(vehicle_id="TEST-2"),
                ]
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual([r["success"] for r in response.json()["results"]], [True, False, True])
        self.assertEqual(self.vehicle()["current_soc"], 30)
        self.assertNotIn("unknown", self.client.get("/api/telemetry/fleet/latest").json()["data"])
        response = self.client.post(
            "/api/simulation/batch",
            json={"vehicle_ids": ["unknown", "TEST-1"], "route_distance_km": 120},
        )
        self.assertIsNotNone(response.json()["results"][0]["error"])
        self.assertEqual(response.json()["results"][1]["response"]["starting_soc_pct"], 30)

    def test_deletion_recreation_and_immutable_assessment_history(self):
        self.ingest(soc=50)
        old_result = self.assess()
        record = self.client.get("/api/simulation/history").json()[0]
        self.ingest(soc=20, timestamp="2020-01-01T13:00:00Z")
        self.assertEqual(
            self.client.get(f"/api/simulation/{record['id']}").json()["response"], old_result
        )
        payload = self.vehicle()
        self.assertEqual(self.client.delete("/api/vehicles/TEST-1").status_code, 204)
        self.assertEqual(self.client.get("/api/telemetry/TEST-1/history").status_code, 404)
        self.assertNotIn("TEST-1", self.client.get("/api/telemetry/fleet/latest").json()["data"])
        self.assertEqual(self.client.post("/api/vehicles/", json=payload).status_code, 201)
        self.assertEqual(self.vehicle()["state_source"], "vehicle_defaults")
        self.assertIsNone(self.vehicle()["state_timestamp"])
        self.assertIsNone(self.client.get("/api/telemetry/TEST-1/latest").json()["data"])
        self.assertEqual(self.client.get("/api/telemetry/TEST-1/history").json(), [])
        self.assertEqual(len(self.client.get("/api/vehicles/TEST-1/history").json()), 1)
        self.assertEqual(
            self.client.get(f"/api/simulation/{record['id']}").json()["response"], old_result
        )

    def test_zero_usable_capacity_is_reported(self):
        self.ingest(soh=0)
        single = self.client.post("/api/simulation/run", json=self.route)
        self.assertEqual(single.status_code, 422)
        self.assertIn("no usable battery capacity", single.json()["detail"])
        compare = self.client.post(
            "/api/simulation/compare",
            json={**self.route, "configs": [{"label": "A"}, {"label": "B"}]},
        )
        self.assertEqual(compare.status_code, 422)
        batch = self.client.post("/api/simulation/batch", json={"route_distance_km": 120})
        self.assertIsNotNone(batch.json()["results"][0]["error"])
        self.assertIsNotNone(batch.json()["results"][1]["response"])

    def test_concurrent_ingestion_preserves_newest_reading(self):
        events = [self.event(soc=i, timestamp=f"2020-01-01T12:{i:02}:00Z") for i in range(20)]
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(
                pool.map(
                    lambda event: self.client.post("/api/telemetry/ingest", json=event),
                    reversed(events),
                )
            )
        self.assertTrue(all(r.status_code == 200 for r in responses))
        self.assertEqual(self.vehicle()["current_soc"], 19)
        self.assertEqual(self.assess()["starting_soc_pct"], 19)
        self.assertEqual(len(self.client.get("/api/telemetry/TEST-1/history").json()), 20)


if __name__ == "__main__":
    unittest.main()
