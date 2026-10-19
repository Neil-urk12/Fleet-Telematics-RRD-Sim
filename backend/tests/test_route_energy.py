"""Numerical and HTTP checks for route energy and vehicle energy profiles."""

import unittest

from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.simulation import SIMULATION_HISTORY
from app.core import fleet_state
from app.core.simulator import calculate_simulation
from app.main import app
from app.schemas.simulation import (
    BatchSimulationRequest,
    CompareSimulationRequest,
    SimulationRequest,
)
from app.schemas.vehicle import Vehicle, VehicleCreate, VehicleUpdate


class RouteEnergyTests(unittest.TestCase):
    def setUp(self):
        self.profile = {
            "id": "ENERGY-TEST",
            "name": "Energy test vehicle",
            "model": "Illustrative EV",
            "battery_capacity_kwh": 75,
            "baseline_efficiency_wh_km": 200,
            "curb_mass_kg": 2000,
            "regen_efficiency": 0.6,
            "current_soc": 80,
            "current_soh": 100,
        }
        self.route = {
            "vehicle_id": "ENERGY-TEST",
            "route_distance_km": 100,
            "hvac_mode": "OFF",
        }

    def calculate(self, profile=None, **conditions):
        vehicle = Vehicle(**{**self.profile, **(profile or {})})
        request = SimulationRequest(**{**self.route, **conditions})
        return calculate_simulation(request, vehicle)

    def test_legacy_requests_keep_their_defaults_and_energy(self):
        profile = {
            k: v for k, v in self.profile.items() if k not in ("curb_mass_kg", "regen_efficiency")
        }
        profile["baseline_efficiency_wh_km"] = 160
        vehicle = Vehicle(**profile)
        request = SimulationRequest(
            vehicle_id=vehicle.id, route_distance_km=100, elevation_gain_m=100, payload_kg=500
        )
        result = calculate_simulation(request, vehicle)
        legacy_energy = ((160 * 1.025 + 30) * 100 / 1000) + (3000 * 9.81 * 100 / 2_880_000)
        self.assertEqual(vehicle.curb_mass_kg, 2500)
        self.assertEqual(request.road_type, "MIXED")
        self.assertEqual(request.elevation_loss_m, 0)
        self.assertEqual(result.estimated_energy_consumption_kwh, round(legacy_energy, 2))

    def test_road_type_scales_propulsion_but_not_hvac(self):
        for road_type, expected in (("MIXED", 20), ("URBAN", 21), ("HIGHWAY", 23)):
            with self.subTest(road_type=road_type):
                result = self.calculate(road_type=road_type, hvac_mode="HIGH")
                self.assertEqual(result.propulsion_energy_kwh, expected)
                self.assertEqual(result.hvac_energy_kwh, 5.5)
                self.assertEqual(result.estimated_energy_consumption_kwh, expected + 5.5)

    def test_descent_recovery_uses_mass_efficiency_and_regen_level(self):
        for level, multiplier in (("OFF", 0), ("LOW", 0.35), ("MEDIUM", 0.65), ("HIGH", 1)):
            with self.subTest(regen_level=level):
                result = self.calculate(elevation_loss_m=1000, regen_level=level)
                recovery = 2000 * 9.81 * 1000 / 3_600_000 * 0.6 * multiplier
                self.assertEqual(result.recovered_regen_energy_kwh, round(recovery, 2))
                self.assertEqual(result.estimated_energy_consumption_kwh, round(20 - recovery, 2))
                self.assertEqual(
                    result.projected_arrival_soc_pct, round(80 - (20 - recovery) / 75 * 100, 1)
                )

    def test_stronger_regen_reduces_descent_energy_and_improves_arrival(self):
        results = [
            self.calculate(elevation_loss_m=1000, regen_level=level)
            for level in ("OFF", "LOW", "MEDIUM", "HIGH")
        ]
        for weaker, stronger in zip(results[:-1], results[1:], strict=True):
            self.assertLess(
                stronger.estimated_energy_consumption_kwh, weaker.estimated_energy_consumption_kwh
            )
            self.assertGreater(stronger.projected_arrival_soc_pct, weaker.projected_arrival_soc_pct)

    def test_regen_has_no_effect_without_descent_or_recovery_efficiency(self):
        baseline = self.calculate(regen_level="OFF")
        self.assertEqual(self.calculate(regen_level="HIGH"), baseline)
        no_recovery = self.calculate(profile={"regen_efficiency": 0}, elevation_loss_m=1000)
        self.assertEqual(no_recovery.vehicle_profile.regen_efficiency, 0)
        self.assertEqual(
            no_recovery.model_dump(exclude={"vehicle_profile"}),
            baseline.model_dump(exclude={"vehicle_profile"}),
        )

    def test_vehicle_mass_and_payload_affect_climbing(self):
        light = self.calculate(elevation_gain_m=1000)
        heavy = self.calculate(profile={"curb_mass_kg": 3000}, elevation_gain_m=1000)
        loaded = self.calculate(elevation_gain_m=1000, payload_kg=1000)
        self.assertEqual(light.climb_energy_kwh, round(2000 * 9.81 * 1000 / 2_880_000, 2))
        self.assertEqual(heavy.climb_energy_kwh, loaded.climb_energy_kwh)
        self.assertGreater(loaded.propulsion_energy_kwh, light.propulsion_energy_kwh)
        self.assertGreater(
            loaded.estimated_energy_consumption_kwh, heavy.estimated_energy_consumption_kwh
        )

    def test_payload_penalty_scales_relative_to_curb_mass(self):
        light = self.calculate(payload_kg=1000)
        heavy = self.calculate(profile={"curb_mass_kg": 4000}, payload_kg=1000)
        self.assertEqual(light.propulsion_energy_kwh, 21.25)
        self.assertEqual(heavy.propulsion_energy_kwh, 20.62)

    def test_payload_cannot_improve_range_including_descents(self):
        for gain, loss in ((0, 0), (1000, 0), (1000, 1000), (0, 1000), (0, 10000), (100, 1000)):
            for level in ("OFF", "LOW", "MEDIUM", "HIGH"):
                with self.subTest(gain=gain, loss=loss, regen_level=level):
                    results = [
                        self.calculate(
                            payload_kg=payload,
                            elevation_gain_m=gain,
                            elevation_loss_m=loss,
                            regen_level=level,
                        )
                        for payload in (0, 500, 1000)
                    ]
                    for lighter, heavier in zip(results[:-1], results[1:], strict=True):
                        self.assertGreater(
                            heavier.propulsion_energy_kwh, lighter.propulsion_energy_kwh
                        )
                        self.assertGreaterEqual(
                            heavier.estimated_energy_consumption_kwh,
                            lighter.estimated_energy_consumption_kwh,
                        )
                        self.assertLessEqual(
                            heavier.projected_arrival_soc_pct, lighter.projected_arrival_soc_pct
                        )
                        self.assertLessEqual(heavier.remaining_range_km, lighter.remaining_range_km)

    def test_payload_recovery_is_capped_at_added_demand_on_descent(self):
        # The extra 1000 kg adds 1.25 kWh demand. Its potential 1.635 kWh
        # recovery must be capped at that demand to prevent a range increase.
        unloaded = self.calculate(elevation_loss_m=1000, regen_level="HIGH")
        loaded = self.calculate(elevation_loss_m=1000, regen_level="HIGH", payload_kg=1000)
        self.assertEqual(unloaded.propulsion_energy_kwh, 20)
        self.assertEqual(loaded.propulsion_energy_kwh, 21.25)
        self.assertEqual(unloaded.recovered_regen_energy_kwh, 3.27)
        self.assertEqual(loaded.recovered_regen_energy_kwh, 4.52)
        self.assertEqual(unloaded.estimated_energy_consumption_kwh, 16.73)
        self.assertEqual(loaded.estimated_energy_consumption_kwh, 16.73)
        self.assertEqual(unloaded.remaining_range_km, 258.6)
        self.assertEqual(loaded.remaining_range_km, 258.6)
        self.assertEqual(loaded.projected_arrival_soc_pct, unloaded.projected_arrival_soc_pct)

        # Smaller recovery still uses the payload's mass when the cap is inactive.
        medium = self.calculate(elevation_loss_m=1000, regen_level="MEDIUM", payload_kg=1000)
        self.assertEqual(medium.recovered_regen_energy_kwh, 3.19)
        self.assertEqual(medium.estimated_energy_consumption_kwh, 18.06)

        # The recovery allowance includes the payload's added climbing demand.
        climbing = self.calculate(
            elevation_gain_m=100, elevation_loss_m=1000, regen_level="HIGH", payload_kg=1000
        )
        self.assertEqual(climbing.recovered_regen_energy_kwh, 4.86)
        self.assertEqual(climbing.estimated_energy_consumption_kwh, 17.41)

        # With recovery disabled, the same descent retains the payload penalty.
        unloaded_off = self.calculate(elevation_loss_m=1000, regen_level="OFF")
        loaded_off = self.calculate(elevation_loss_m=1000, regen_level="OFF", payload_kg=1000)
        self.assertEqual(unloaded_off.recovered_regen_energy_kwh, 0)
        self.assertEqual(loaded_off.recovered_regen_energy_kwh, 0)
        self.assertGreater(
            loaded_off.estimated_energy_consumption_kwh,
            unloaded_off.estimated_energy_consumption_kwh,
        )
        self.assertLess(loaded_off.remaining_range_km, unloaded_off.remaining_range_km)

    def test_round_trip_elevation_cannot_create_energy(self):
        flat = self.calculate()
        hills = self.calculate(elevation_gain_m=1000, elevation_loss_m=1000, regen_level="HIGH")
        self.assertGreater(
            hills.estimated_energy_consumption_kwh, flat.estimated_energy_consumption_kwh
        )
        self.assertLess(hills.recovered_regen_energy_kwh, hills.climb_energy_kwh)

    def test_recovery_is_capped_at_route_demand(self):
        for distance, payload in ((0.01, 0), (0.01, 1000), (100, 0), (100, 1000)):
            with self.subTest(route_distance_km=distance, payload_kg=payload):
                result = self.calculate(
                    route_distance_km=distance,
                    elevation_loss_m=10000,
                    regen_level="HIGH",
                    payload_kg=payload,
                )
                self.assertEqual(result.estimated_energy_consumption_kwh, 0)
                self.assertEqual(result.projected_arrival_soc_pct, 80)
                self.assertEqual(
                    result.recovered_regen_energy_kwh,
                    result.propulsion_energy_kwh + result.hvac_energy_kwh + result.climb_energy_kwh,
                )
                self.assertGreaterEqual(result.remaining_range_km, 0)

    def test_energy_breakdown_matches_total_with_rounding_tolerance(self):
        result = self.calculate(
            payload_kg=450, elevation_gain_m=1234, elevation_loss_m=567, hvac_mode="HIGH"
        )
        breakdown = (
            result.propulsion_energy_kwh
            + result.hvac_energy_kwh
            + result.climb_energy_kwh
            - result.recovered_regen_energy_kwh
        )
        self.assertAlmostEqual(breakdown, result.estimated_energy_consumption_kwh, delta=0.03)

    def test_invalid_route_inputs_are_rejected_in_all_request_models(self):
        for model, base in (
            (SimulationRequest, self.route),
            (BatchSimulationRequest, {"route_distance_km": 100}),
            (CompareSimulationRequest, {**self.route, "configs": [{"label": "A"}, {"label": "B"}]}),
        ):
            for invalid in (
                {"elevation_loss_m": -1},
                {"elevation_loss_m": float("inf")},
                {"elevation_loss_m": float("nan")},
                {"road_type": "UNKNOWN"},
            ):
                with (
                    self.subTest(model=model.__name__, invalid=invalid),
                    self.assertRaises(ValidationError),
                ):
                    model(**{**base, **invalid})

    def test_invalid_vehicle_profiles_are_rejected(self):
        for invalid in (
            {"curb_mass_kg": 0},
            {"curb_mass_kg": -1},
            {"curb_mass_kg": float("inf")},
            {"regen_efficiency": -0.1},
            {"regen_efficiency": 1.1},
            {"regen_efficiency": float("nan")},
        ):
            for model, base in ((VehicleCreate, self.profile), (VehicleUpdate, {})):
                with (
                    self.subTest(model=model.__name__, invalid=invalid),
                    self.assertRaises(ValidationError),
                ):
                    model(**{**base, **invalid})


class RouteEnergyApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        self.history = list(SIMULATION_HISTORY)
        response = self.client.post(
            "/api/vehicles/",
            json={
                "id": "ROUTE-API-TEST",
                "name": "Route API test",
                "model": "Illustrative EV",
                "battery_capacity_kwh": 75,
                "baseline_efficiency_wh_km": 200,
                "curb_mass_kg": 2000,
                "regen_efficiency": 0.6,
                "current_soc": 80,
                "current_soh": 100,
            },
        )
        self.assertEqual(response.status_code, 201)
        self.route = {
            "vehicle_id": "ROUTE-API-TEST",
            "route_distance_km": 100,
            "elevation_gain_m": 1000,
            "elevation_loss_m": 800,
            "road_type": "HIGHWAY",
            "regen_level": "HIGH",
        }

    def tearDown(self):
        fleet_state.delete_vehicle("ROUTE-API-TEST")
        SIMULATION_HISTORY[:] = self.history
        self.client.close()

    def test_single_batch_compare_and_history_keep_new_route_inputs(self):
        single = self.client.post("/api/simulation/run", json=self.route)
        self.assertEqual(single.status_code, 200)
        result = single.json()
        self.assertEqual(result["propulsion_energy_kwh"], 23)
        self.assertGreater(result["recovered_regen_energy_kwh"], 0)
        batch = self.client.post(
            "/api/simulation/batch",
            json={
                **self.route,
                "vehicle_ids": [self.route["vehicle_id"]],
            },
        )
        self.assertEqual(batch.status_code, 200)
        self.assertEqual(batch.json()["results"][0]["response"], result)
        compare = self.client.post(
            "/api/simulation/compare",
            json={
                **self.route,
                "configs": [
                    {"label": "Off", "regen_level": "OFF"},
                    {"label": "High", "regen_level": "HIGH"},
                ],
            },
        )
        self.assertEqual(compare.status_code, 200)
        results = compare.json()["results"]
        self.assertEqual(results[1]["response"], result)
        self.assertEqual(results[0]["response"]["recovered_regen_energy_kwh"], 0)
        records = self.client.get(
            "/api/simulation/history", params={"vehicle_id": self.route["vehicle_id"]}
        ).json()
        self.assertEqual(len(records), 4)
        for record in records:
            self.assertEqual(record["request"]["road_type"], "HIGHWAY")
            self.assertEqual(record["request"]["elevation_loss_m"], 800)

    def test_profile_patch_changes_energy_and_preserves_battery_source(self):
        before = self.client.post("/api/simulation/run", json=self.route).json()
        updated = self.client.patch(
            "/api/vehicles/ROUTE-API-TEST",
            json={
                "curb_mass_kg": 3000,
                "regen_efficiency": 0.3,
            },
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json()["state_source"], "vehicle_defaults")
        self.assertIsNone(updated.json()["state_timestamp"])
        after = self.client.post("/api/simulation/run", json=self.route).json()
        self.assertGreater(after["climb_energy_kwh"], before["climb_energy_kwh"])
        self.assertLess(after["recovered_regen_energy_kwh"], before["recovered_regen_energy_kwh"])
        for invalid in (
            {"curb_mass_kg": 0},
            {"regen_efficiency": 2},
            {"curb_mass_kg": None},
            {"regen_efficiency": None},
        ):
            response = self.client.patch("/api/vehicles/ROUTE-API-TEST", json=invalid)
            self.assertEqual(response.status_code, 422)
            self.assertEqual(self.client.get("/api/vehicles/ROUTE-API-TEST").json(), updated.json())

    def test_invalid_route_requests_have_no_history_side_effects(self):
        before = len(SIMULATION_HISTORY)
        for endpoint, extra in (
            ("run", {}),
            ("batch", {"vehicle_ids": [self.route["vehicle_id"]]}),
            ("compare", {"configs": [{"label": "A"}, {"label": "B"}]}),
        ):
            for invalid in ({"elevation_loss_m": -1}, {"road_type": "UNKNOWN"}):
                response = self.client.post(
                    f"/api/simulation/{endpoint}", json={**self.route, **extra, **invalid}
                )
                self.assertEqual(response.status_code, 422)
        self.assertEqual(len(SIMULATION_HISTORY), before)


if __name__ == "__main__":
    unittest.main()
