"""Numerical and HTTP checks for the operational-history battery stress overlay."""

import unittest

from fastapi.testclient import TestClient

from app.core import fleet_state
from app.core.battery_history import assess_battery_history
from app.core.simulator import calculate_simulation
from app.main import app
from app.schemas.simulation import SimulationRequest
from app.schemas.vehicle import Vehicle, VehicleUpdate


def make_vehicle(**history) -> Vehicle:
    profile = {
        "id": "HISTORY-TEST",
        "name": "History test vehicle",
        "model": "Illustrative EV",
        "battery_capacity_kwh": 100,
        "baseline_efficiency_wh_km": 200,
        "curb_mass_kg": 2500,
        "regen_efficiency": 0.6,
        "current_soc": 80,
        "current_soh": 100,
    }
    profile.update(history)
    return Vehicle(**profile)


def assess(**history):
    return assess_battery_history(make_vehicle(**history))


class BatteryHistoryScoringTests(unittest.TestCase):
    def test_unreported_history_is_not_assessed_and_not_adjusted(self):
        result = assess()
        self.assertIsNone(result.stress_score)
        self.assertIsNone(result.stress_class)
        self.assertEqual(result.capacity_factor, 1.0)

    def test_reported_history_produces_a_score_and_class(self):
        result = assess(
            cycle_count=1610, avg_dod_pct=88, fast_charge_share_pct=58, thermal_stress_index=71
        )
        self.assertIsNotNone(result.stress_score)
        self.assertEqual(result.stress_class, "HIGH")
        self.assertLess(result.capacity_factor, 1.0)
        self.assertGreaterEqual(result.capacity_factor, 0.96)

    def test_stress_increases_monotonically_with_each_indicator(self):
        low_high = {
            "cycle_count": (400, 1200),
            "avg_dod_pct": (60, 95),
            "fast_charge_share_pct": (10, 45),
            "thermal_stress_index": (20, 80),
        }
        for field, (low_value, high_value) in low_high.items():
            with self.subTest(field=field):
                low = assess(**{field: low_value})
                high = assess(**{field: high_value})
                assert low.stress_score is not None and high.stress_score is not None
                self.assertGreater(high.stress_score, low.stress_score)
                self.assertLess(high.capacity_factor, low.capacity_factor)

    def test_partial_history_uses_only_reported_indicators(self):
        # Only cycles are reported, so the score reflects the cycle indicator alone
        # and the other indicators cannot pull it down.
        cycles_only = assess(cycle_count=1500)
        self.assertEqual(cycles_only.stress_score, 100.0)
        self.assertEqual(cycles_only.stress_class, "HIGH")
        # A benign cycle count with no other reported indicators stays normal.
        benign = assess(cycle_count=0)
        self.assertEqual(benign.stress_score, 0.0)
        self.assertEqual(benign.stress_class, "NORMAL")

    def test_reported_zero_history_is_distinct_from_unreported(self):
        reported_zero = assess(
            cycle_count=0, avg_dod_pct=0, fast_charge_share_pct=0, thermal_stress_index=0
        )
        self.assertEqual(reported_zero.stress_score, 0.0)
        self.assertEqual(reported_zero.stress_class, "NORMAL")
        self.assertIsNone(assess().stress_score)

    def test_capacity_penalty_is_bounded(self):
        worst = assess(
            cycle_count=100_000,
            avg_dod_pct=100,
            fast_charge_share_pct=100,
            thermal_stress_index=100,
        )
        self.assertEqual(worst.stress_score, 100.0)
        self.assertGreaterEqual(worst.capacity_factor, 0.96)
        self.assertLessEqual(worst.capacity_factor, 1.0)


class BatteryHistorySimulationTests(unittest.TestCase):
    def calculate(self, **history):
        vehicle = make_vehicle(**history)
        request = SimulationRequest(vehicle_id=vehicle.id, route_distance_km=100, hvac_mode="OFF")
        return calculate_simulation(request, vehicle)

    def test_history_reduces_usable_capacity(self):
        without = self.calculate()
        with_history = self.calculate(
            cycle_count=1610,
            avg_dod_pct=88,
            fast_charge_share_pct=58,
            thermal_stress_index=71,
        )
        self.assertLess(
            with_history.usable_battery_capacity_kwh, without.usable_battery_capacity_kwh
        )
        self.assertLess(with_history.projected_arrival_soc_pct, without.projected_arrival_soc_pct)
        self.assertLess(with_history.remaining_range_km, without.remaining_range_km)
        self.assertEqual(without.battery_history.capacity_factor, 1.0)

    def test_history_does_not_change_route_energy_demand(self):
        without = self.calculate()
        with_history = self.calculate(
            cycle_count=1610,
            avg_dod_pct=88,
            fast_charge_share_pct=58,
            thermal_stress_index=71,
        )
        self.assertEqual(
            with_history.estimated_energy_consumption_kwh,
            without.estimated_energy_consumption_kwh,
        )

    def test_assessment_reports_the_history_it_used(self):
        result = self.calculate(
            cycle_count=1610, avg_dod_pct=88, fast_charge_share_pct=58, thermal_stress_index=71
        )
        self.assertEqual(result.battery_history.stress_class, "HIGH")
        self.assertEqual(result.vehicle_profile.cycle_count, 1610)
        self.assertEqual(result.vehicle_profile.avg_dod_pct, 88)
        self.assertEqual(result.vehicle_profile.fast_charge_share_pct, 58)
        self.assertEqual(result.vehicle_profile.thermal_stress_index, 71)


class BatteryHistoryApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def tearDown(self):
        fleet_state.delete_vehicle("HISTORY-API-TEST")
        self.client.close()

    def create(self, **overrides):
        payload = {
            "id": "HISTORY-API-TEST",
            "name": "History API test",
            "model": "Illustrative EV",
            "battery_capacity_kwh": 100,
            "baseline_efficiency_wh_km": 200,
            "current_soc": 80,
            "current_soh": 100,
        }
        payload.update(overrides)
        response = self.client.post("/api/vehicles/", json=payload)
        self.assertEqual(response.status_code, 201)
        return response.json()

    def test_vehicle_responses_expose_the_assessment(self):
        vehicle = self.create(
            cycle_count=1610, avg_dod_pct=88, fast_charge_share_pct=58, thermal_stress_index=71
        )
        self.assertEqual(vehicle["battery_history"]["stress_class"], "HIGH")
        fetched = self.client.get("/api/vehicles/HISTORY-API-TEST").json()
        self.assertEqual(fetched["battery_history"], vehicle["battery_history"])
        fleet = self.client.get("/api/vehicles/").json()
        listed = next(v for v in fleet if v["id"] == "HISTORY-API-TEST")
        self.assertEqual(listed["battery_history"], vehicle["battery_history"])

    def test_unreported_history_is_assessed_as_unknown(self):
        vehicle = self.create()
        self.assertIsNone(vehicle["battery_history"]["stress_score"])
        self.assertIsNone(vehicle["battery_history"]["stress_class"])
        self.assertEqual(vehicle["battery_history"]["capacity_factor"], 1.0)

    def test_history_can_be_updated_and_changes_the_assessment(self):
        self.create()
        before = self.client.post(
            "/api/simulation/run",
            json={"vehicle_id": "HISTORY-API-TEST", "route_distance_km": 100},
        ).json()
        updated = self.client.patch(
            "/api/vehicles/HISTORY-API-TEST",
            json={
                "cycle_count": 1610,
                "avg_dod_pct": 88,
                "fast_charge_share_pct": 58,
                "thermal_stress_index": 71,
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["battery_history"]["stress_class"], "HIGH")
        after = self.client.post(
            "/api/simulation/run",
            json={"vehicle_id": "HISTORY-API-TEST", "route_distance_km": 100},
        ).json()
        self.assertLess(after["usable_battery_capacity_kwh"], before["usable_battery_capacity_kwh"])

    def test_history_edits_preserve_battery_provenance(self):
        self.create()
        response = self.client.patch("/api/vehicles/HISTORY-API-TEST", json={"cycle_count": 500})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["state_source"], "vehicle_defaults")
        self.assertIsNone(response.json()["state_timestamp"])

    def test_invalid_history_values_are_rejected(self):
        self.create()
        for invalid in (
            {"cycle_count": -1},
            {"avg_dod_pct": -1},
            {"avg_dod_pct": 101},
            {"fast_charge_share_pct": 101},
            {"thermal_stress_index": 101},
        ):
            with self.subTest(invalid=invalid):
                response = self.client.patch("/api/vehicles/HISTORY-API-TEST", json=invalid)
                self.assertEqual(response.status_code, 422)
        vehicle = self.client.get("/api/vehicles/HISTORY-API-TEST").json()
        self.assertIsNone(vehicle["cycle_count"])

    def test_assessment_history_survives_later_edits(self):
        self.create(
            cycle_count=1610, avg_dod_pct=88, fast_charge_share_pct=58, thermal_stress_index=71
        )
        result = self.client.post(
            "/api/simulation/run",
            json={"vehicle_id": "HISTORY-API-TEST", "route_distance_km": 100},
        ).json()
        self.client.patch("/api/vehicles/HISTORY-API-TEST", json={"cycle_count": 0})
        record = self.client.get("/api/simulation/history").json()[0]
        self.assertEqual(record["response"]["battery_history"], result["battery_history"])


class VehicleUpdateHistoryValidationTests(unittest.TestCase):
    def test_update_model_rejects_out_of_range_history(self):
        from pydantic import ValidationError

        for invalid in (
            {"cycle_count": -1},
            {"avg_dod_pct": 101},
            {"fast_charge_share_pct": -0.5},
            {"thermal_stress_index": 100.5},
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ValidationError):
                    VehicleUpdate(**invalid)


if __name__ == "__main__":
    unittest.main()
