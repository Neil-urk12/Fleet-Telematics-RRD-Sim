"""Regression checks for vehicle specifications captured by assessments."""

import unittest
from unittest.mock import patch

from app.api import simulation, vehicles
from app.core import fleet_state
from app.core.simulator import calculate_simulation
from app.schemas.simulation import (
    BatchSimulationRequest,
    CompareSimulationRequest,
    SimulationRequest,
)
from app.schemas.vehicle import VehicleCreate, VehicleUpdate


class SimulationProfileTests(unittest.TestCase):
    def setUp(self):
        self.history = list(simulation.SIMULATION_HISTORY)
        self.vehicle = vehicles.create_vehicle(
            VehicleCreate(
                id="PROFILE-SNAPSHOT-TEST",
                name="Profile snapshot test",
                model="Illustrative EV",
                battery_capacity_kwh=75,
                baseline_efficiency_wh_km=260,
                current_soc=80,
                current_soh=95,
            )
        )
        self.profile = {
            "battery_capacity_kwh": 75,
            "baseline_efficiency_wh_km": 260,
            "curb_mass_kg": 2500,
            "regen_efficiency": 0.6,
        }
        self.request = SimulationRequest(
            vehicle_id=self.vehicle.id,
            route_distance_km=120,
            elevation_gain_m=300,
            elevation_loss_m=500,
            ambient_temp_c=22,
            payload_kg=450,
            hvac_mode="LOW",
            regen_level="HIGH",
        )

    def tearDown(self):
        fleet_state.delete_vehicle(self.vehicle.id)
        simulation.SIMULATION_HISTORY[:] = self.history

    def test_single_batch_comparison_and_history_capture_profile(self):
        single = simulation.run_simulation(self.request)
        self.assertEqual(single.model_dump(mode="json")["vehicle_profile"], self.profile)
        conditions = self.request.model_dump(exclude={"vehicle_id"})
        batch = simulation.run_batch_simulation(
            BatchSimulationRequest(vehicle_ids=[self.vehicle.id], **conditions)
        )
        self.assertEqual(batch.results[0].response.vehicle_profile.model_dump(), self.profile)
        comparison = simulation.compare_simulations(
            CompareSimulationRequest(
                vehicle_id=self.vehicle.id,
                configs=[{"label": "Normal"}, {"label": "Eco", "driving_style": "ECO"}],
                **conditions,
            )
        )
        for result in comparison.results:
            self.assertEqual(result.response.vehicle_profile.model_dump(), self.profile)
        records = simulation.list_simulation_history(self.vehicle.id)
        self.assertEqual(len(records), 4)
        for record in records:
            self.assertEqual(record.response.vehicle_profile.model_dump(), self.profile)

    def test_specification_edits_preserve_original_assessment_profile(self):
        before = simulation.run_simulation(self.request)
        for field, value in (
            ("battery_capacity_kwh", 40),
            ("baseline_efficiency_wh_km", 500),
            ("curb_mass_kg", 4000),
            ("regen_efficiency", 0.1),
        ):
            with self.subTest(field=field):
                updated = vehicles.update_vehicle(self.vehicle.id, VehicleUpdate(**{field: value}))
                for key in ("current_soc", "current_soh", "state_source", "state_timestamp"):
                    self.assertEqual(getattr(updated, key), getattr(self.vehicle, key))
                after = simulation.run_simulation(self.request)
                self.assertEqual(getattr(after.vehicle_profile, field), value)
                self.assertEqual(before.vehicle_profile.model_dump(), self.profile)
                first = simulation.list_simulation_history(self.vehicle.id)[0]
                self.assertEqual(first.response.vehicle_profile.model_dump(), self.profile)

    def test_edit_during_calculation_does_not_change_captured_profile(self):
        def edit_profile(request, vehicle):
            vehicles.update_vehicle(self.vehicle.id, VehicleUpdate(battery_capacity_kwh=40))
            return calculate_simulation(request, vehicle)

        with patch("app.api.simulation.calculate_simulation", side_effect=edit_profile):
            result = simulation.run_simulation(self.request)
        self.assertEqual(result.vehicle_profile.model_dump(), self.profile)
        self.assertEqual(fleet_state.get_vehicle(self.vehicle.id).battery_capacity_kwh, 40)


if __name__ == "__main__":
    unittest.main()
