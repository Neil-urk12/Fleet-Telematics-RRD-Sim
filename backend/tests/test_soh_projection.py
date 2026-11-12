"""Checks for the SOH trend fit and the degradation outlook endpoint."""

import unittest
from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from app.api import simulation, vehicles
from app.core import fleet_state
from app.core.soh_projection import fit_soh_trend, project_soh
from app.main import app
from app.schemas.vehicle import (
    BatteryHistory,
    VehicleCreate,
    VehicleHistoryEntry,
    VehicleUpdate,
)

NOW = datetime(2026, 11, 1, tzinfo=UTC)


def entries(*points: tuple[float, float]) -> list[VehicleHistoryEntry]:
    """(days ago, SOH) pairs."""
    return [
        VehicleHistoryEntry(
            timestamp=NOW - timedelta(days=days), current_soc=80, current_soh=soh, status="ACTIVE"
        )
        for days, soh in points
    ]


class SohTrendTests(unittest.TestCase):
    def test_long_history_is_fitted(self):
        trend = fit_soh_trend(entries((365.25, 96), (182.625, 94), (0, 92)), BatteryHistory())
        self.assertEqual(trend.basis, "RECORDED")
        self.assertAlmostEqual(trend.soh_loss_pct_per_year, 4.0, places=2)
        self.assertEqual(trend.readings_used, 3)

    def test_short_or_missing_history_uses_assumed_rate(self):
        for history in ([], entries((0, 95)), entries((1, 96), (0, 90))):
            trend = fit_soh_trend(history, BatteryHistory())
            self.assertEqual(trend.basis, "ASSUMED")
            self.assertEqual(trend.soh_loss_pct_per_year, 2.0)

    def test_history_stress_scales_assumed_rate(self):
        trend = fit_soh_trend([], BatteryHistory(stress_score=50, stress_class="ELEVATED"))
        self.assertEqual(trend.soh_loss_pct_per_year, 3.0)

    def test_rising_soh_is_not_projected_as_recovery(self):
        trend = fit_soh_trend(entries((100, 90), (0, 93)), BatteryHistory())
        self.assertEqual((trend.basis, trend.soh_loss_pct_per_year), ("RECORDED", 0.0))

    def test_projection_stops_at_zero(self):
        self.assertEqual(project_soh(95, 2, 5), 85.0)
        self.assertEqual(project_soh(5, 4, 5), 0.0)


class DegradationEndpointTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.saved = list(simulation.SIMULATION_HISTORY)
        self.vehicle = vehicles.create_vehicle(
            VehicleCreate(
                id="DEGRADATION-TEST",
                name="Degradation test",
                model="Illustrative EV",
                battery_capacity_kwh=75,
                baseline_efficiency_wh_km=200,
                current_soc=80,
                current_soh=90,
            )
        )
        self.body = {"vehicle_id": self.vehicle.id, "route_distance_km": 200}

    def tearDown(self):
        fleet_state.delete_vehicle(self.vehicle.id)
        simulation.SIMULATION_HISTORY[:] = self.saved

    def test_later_horizons_arrive_lower_and_nothing_is_saved(self):
        response = self.client.post("/api/simulation/degradation", json=self.body)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["basis"], "ASSUMED")
        self.assertEqual([p["years_ahead"] for p in data["points"]], [0, 1, 2, 3, 5])
        self.assertEqual([p["projected_soh_pct"] for p in data["points"]], [90, 88, 86, 84, 80])
        arrivals = [p["projected_arrival_soc_pct"] for p in data["points"]]
        self.assertEqual(arrivals, sorted(arrivals, reverse=True))
        self.assertGreater(arrivals[0], arrivals[-1])
        self.assertEqual(simulation.SIMULATION_HISTORY, self.saved)

        current = self.client.post("/api/simulation/run", json=self.body).json()
        self.assertEqual(arrivals[0], current["projected_arrival_soc_pct"])

    def test_today_uses_the_unrounded_soh_like_run(self):
        fleet_state.update_vehicle(self.vehicle.id, VehicleUpdate(current_soh=89.96))
        today = self.client.post("/api/simulation/degradation", json=self.body).json()["points"][0]
        current = self.client.post("/api/simulation/run", json=self.body).json()
        self.assertEqual(today["projected_soh_pct"], 89.96)
        self.assertEqual(today["projected_arrival_soc_pct"], current["projected_arrival_soc_pct"])
        self.assertEqual(today["predicted_range_km"], current["predicted_range_km"])

    def test_recorded_history_sets_the_rate_and_drops_dead_packs(self):
        fleet_state.VEHICLE_HISTORY[self.vehicle.id] = entries((365.25, 90), (0, 60))
        data = self.client.post("/api/simulation/degradation", json=self.body).json()
        self.assertEqual((data["basis"], data["soh_loss_pct_per_year"]), ("RECORDED", 30.0))
        self.assertEqual([p["projected_soh_pct"] for p in data["points"]], [90, 60, 30])

    def test_unknown_vehicle_is_404(self):
        response = self.client.post(
            "/api/simulation/degradation", json={**self.body, "vehicle_id": "EV-404"}
        )
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
