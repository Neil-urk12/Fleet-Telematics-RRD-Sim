"""Checks for the heuristic uncertainty band and computed completion confidence."""

import unittest

from app.core.simulator import calculate_simulation
from app.schemas.simulation import SimulationRecord, SimulationRequest
from app.schemas.vehicle import Vehicle

BAND_FIELDS = (
    "uncertainty_pct",
    "predicted_range_km",
    "predicted_range_low_km",
    "predicted_range_high_km",
    "arrival_soc_low_pct",
    "arrival_soc_high_pct",
)


class ConfidenceBandTests(unittest.TestCase):
    def setUp(self):
        self.profile = {
            "id": "BAND-TEST",
            "name": "Band test vehicle",
            "model": "Illustrative EV",
            "battery_capacity_kwh": 75,
            "baseline_efficiency_wh_km": 200,
            "curb_mass_kg": 2000,
            "regen_efficiency": 0.6,
            "current_soc": 80,
            "current_soh": 100,
        }
        self.route = {
            "vehicle_id": "BAND-TEST",
            "route_distance_km": 120,
            "hvac_mode": "OFF",
            "ambient_temp_c": 20,
        }

    def calculate(self, profile=None, **conditions):
        vehicle = Vehicle(**{**self.profile, **(profile or {})})
        request = SimulationRequest(**{**self.route, **conditions})
        return calculate_simulation(request, vehicle)

    def test_benign_conditions_use_base_uncertainty(self):
        self.assertEqual(self.calculate().uncertainty_pct, 5)

    def test_combined_risk_factors_widen_band(self):
        result = self.calculate(ambient_temp_c=-5, driving_style="AGGRESSIVE", road_type="URBAN")
        self.assertEqual(result.uncertainty_pct, 16)

    def test_each_listed_factor_never_narrows_band(self):
        base = self.calculate().uncertainty_pct
        cases = [
            ({}, {"ambient_temp_c": -5}),
            ({}, {"ambient_temp_c": 40}),
            ({}, {"driving_style": "AGGRESSIVE"}),
            ({}, {"road_type": "URBAN"}),
            ({"thermal_stress_index": 50}, {}),
            ({"thermal_stress_index": 100}, {}),
            ({"current_soh": 75}, {}),
        ]
        for profile, conditions in cases:
            with self.subTest(profile=profile, conditions=conditions):
                self.assertGreater(self.calculate(profile, **conditions).uncertainty_pct, base)
        elevated = self.calculate({"thermal_stress_index": 50})
        high = self.calculate({"thermal_stress_index": 100})
        self.assertEqual(elevated.battery_history.stress_class, "ELEVATED")
        self.assertEqual(high.battery_history.stress_class, "HIGH")
        self.assertLess(elevated.uncertainty_pct, high.uncertainty_pct)

    def test_unlisted_inputs_do_not_change_band(self):
        base = self.calculate().uncertainty_pct
        for conditions in (
            {"hvac_mode": "HIGH"},
            {"payload_kg": 500},
            {"elevation_gain_m": 800},
            {"road_type": "HIGHWAY"},
            {"driving_style": "ECO"},
        ):
            with self.subTest(conditions=conditions):
                self.assertEqual(self.calculate(**conditions).uncertainty_pct, base)

    def test_bands_bracket_point_values(self):
        for conditions in (
            {},
            {"ambient_temp_c": -10, "driving_style": "AGGRESSIVE"},
            {"route_distance_km": 600},
            {"elevation_loss_m": 1500, "regen_level": "HIGH"},
        ):
            with self.subTest(conditions=conditions):
                r = self.calculate(**conditions)
                self.assertLessEqual(r.predicted_range_low_km, r.predicted_range_km)
                self.assertLessEqual(r.predicted_range_km, r.predicted_range_high_km)
                self.assertLessEqual(r.arrival_soc_low_pct, r.projected_arrival_soc_pct)
                self.assertLessEqual(r.projected_arrival_soc_pct, r.arrival_soc_high_pct)

    def test_predicted_range_matches_departure_energy_over_rate(self):
        # 60 kWh at departure, 24 kWh over 120 km = 0.2 kWh/km.
        self.assertEqual(self.calculate().predicted_range_km, 300.0)

    def test_empty_battery_has_zero_range(self):
        r = self.calculate({"current_soc": 0})
        self.assertEqual(
            (r.predicted_range_km, r.predicted_range_low_km, r.predicted_range_high_km),
            (0.0, 0.0, 0.0),
        )

    def test_arrival_exactly_at_reserve_is_even_odds(self):
        # 60 kWh - 24 kWh leaves 36 kWh of 75 kWh: exactly 48%.
        r = self.calculate(reserve_soc_target_pct=48)
        self.assertEqual(r.projected_arrival_soc_pct, 48.0)
        self.assertEqual(r.confidence_score_pct, 50.0)

    def test_higher_reserve_never_raises_confidence(self):
        scores = [
            self.calculate(reserve_soc_target_pct=reserve).confidence_score_pct
            for reserve in range(0, 51, 5)
        ]
        self.assertEqual(scores, sorted(scores, reverse=True))
        self.assertGreater(scores[0], 99)
        self.assertLess(scores[-1], 50)

    def test_zero_route_energy_confidence_is_all_or_nothing(self):
        descent = {
            "route_distance_km": 1,
            "elevation_loss_m": 1000,
            "regen_level": "HIGH",
        }
        met = self.calculate(**descent, reserve_soc_target_pct=15)
        self.assertEqual(met.estimated_energy_consumption_kwh, 0)
        self.assertEqual(met.confidence_score_pct, 100.0)
        missed = self.calculate({"current_soc": 10}, **descent, reserve_soc_target_pct=15)
        self.assertEqual(missed.confidence_score_pct, 0.0)

    def test_classification_still_follows_point_arrival_soc(self):
        # Arrival 48%: just above a 47% reserve is SAFE even with modest confidence.
        just_safe = self.calculate(reserve_soc_target_pct=47)
        self.assertEqual(just_safe.risk_level, "SAFE")
        self.assertLess(just_safe.confidence_score_pct, 90)
        self.assertEqual(self.calculate(route_distance_km=200).risk_level, "SAFE")
        self.assertEqual(
            self.calculate(route_distance_km=200, reserve_soc_target_pct=50).risk_level, "CAUTION"
        )
        self.assertEqual(self.calculate(route_distance_km=290).risk_level, "NOT_RECOMMENDED")

    def test_saved_record_without_band_fields_loads(self):
        record = SimulationRecord(
            request=SimulationRequest(**self.route), response=self.calculate()
        ).model_dump(mode="json")
        for field in BAND_FIELDS:
            del record["response"][field]
        loaded = SimulationRecord.model_validate(record)
        for field in BAND_FIELDS:
            self.assertIsNone(getattr(loaded.response, field))


if __name__ == "__main__":
    unittest.main()
