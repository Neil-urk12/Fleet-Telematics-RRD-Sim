"""Operational-history battery stress overlay.

SOH already reflects a vehicle's accumulated degradation, so this overlay models
the residual stress that SOH does not yet show. Its effect on usable capacity is
therefore deliberately bounded.

These coefficients are illustrative PoC calibration assumptions, not measured
OEM degradation data.
"""

from app.schemas.vehicle import BatteryHistory, Vehicle

# Equivalent full cycles at which the cycle indicator saturates.
CYCLE_REFERENCE = 1500.0
# Depth of discharge that is treated as stress-free; 100% saturates the indicator.
DOD_NEUTRAL_PCT = 50.0
# Fast-charge share that saturates the indicator.
FAST_CHARGE_REFERENCE_PCT = 50.0
# Maximum fraction of usable capacity the overlay may remove.
MAX_CAPACITY_DERATE = 0.04
ELEVATED_THRESHOLD = 35.0
HIGH_THRESHOLD = 70.0

INDICATOR_WEIGHTS = {
    "cycle": 0.30,
    "dod": 0.30,
    "fast_charge": 0.20,
    "thermal": 0.20,
}


def _clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def _normalize(present: dict[str, float]) -> dict[str, float]:
    normalized: dict[str, float] = {}
    if "cycle" in present:
        normalized["cycle"] = _clamp01(present["cycle"] / CYCLE_REFERENCE)
    if "dod" in present:
        normalized["dod"] = _clamp01((present["dod"] - DOD_NEUTRAL_PCT) / (100.0 - DOD_NEUTRAL_PCT))
    if "fast_charge" in present:
        normalized["fast_charge"] = _clamp01(present["fast_charge"] / FAST_CHARGE_REFERENCE_PCT)
    if "thermal" in present:
        normalized["thermal"] = _clamp01(present["thermal"] / 100.0)
    return normalized


def assess_battery_history(vehicle: Vehicle) -> BatteryHistory:
    """Score the reported operational history of a vehicle.

    Unreported indicators are excluded and the remaining weights are renormalized,
    so a partially reported vehicle is not penalized for missing data. A vehicle
    with no reported history is not adjusted and is reported as unassessed.
    """
    reported = {
        "cycle": vehicle.cycle_count,
        "dod": vehicle.avg_dod_pct,
        "fast_charge": vehicle.fast_charge_share_pct,
        "thermal": vehicle.thermal_stress_index,
    }
    present = {key: float(value) for key, value in reported.items() if value is not None}
    if not present:
        return BatteryHistory(stress_score=None, stress_class=None, capacity_factor=1.0)

    normalized = _normalize(present)
    weight_total = sum(INDICATOR_WEIGHTS[key] for key in normalized)
    score = (
        100.0
        * sum(INDICATOR_WEIGHTS[key] * value for key, value in normalized.items())
        / weight_total
    )
    if score < ELEVATED_THRESHOLD:
        stress_class = "NORMAL"
    elif score < HIGH_THRESHOLD:
        stress_class = "ELEVATED"
    else:
        stress_class = "HIGH"

    return BatteryHistory(
        stress_score=round(score, 1),
        stress_class=stress_class,
        capacity_factor=round(1.0 - MAX_CAPACITY_DERATE * score / 100.0, 4),
    )
