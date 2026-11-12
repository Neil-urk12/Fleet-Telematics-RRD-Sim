"""SOH trend fit and forward projection for the degradation outlook."""

from dataclasses import dataclass
from typing import Literal

from app.schemas.vehicle import BatteryHistory, VehicleHistoryEntry

# Illustrative PoC calibration, not measured OEM degradation.
ASSUMED_SOH_LOSS_PCT_PER_YEAR = 2.0
# A fit over a shorter span (e.g. minutes of demo edits) would extrapolate to nonsense.
MIN_TREND_SPAN_DAYS = 30.0
SECONDS_PER_YEAR = 365.25 * 86400.0


@dataclass(frozen=True)
class SohTrend:
    basis: Literal["RECORDED", "ASSUMED"]
    soh_loss_pct_per_year: float
    readings_used: int
    span_days: float


def fit_soh_trend(entries: list[VehicleHistoryEntry], history: BatteryHistory) -> SohTrend:
    """Least-squares SOH loss rate from recorded history, or an assumed rate without enough."""
    times = [entry.timestamp for entry in entries]
    span_days = (max(times) - min(times)).total_seconds() / 86400.0 if times else 0.0
    if span_days >= MIN_TREND_SPAN_DAYS:
        start = min(times)
        xs = [(t - start).total_seconds() / SECONDS_PER_YEAR for t in times]
        ys = [entry.current_soh for entry in entries]
        x_mean = sum(xs) / len(xs)
        y_mean = sum(ys) / len(ys)
        slope = sum((x - x_mean) * (y - y_mean) for x, y in zip(xs, ys, strict=True)) / sum(
            (x - x_mean) ** 2 for x in xs
        )
        # A rising SOH (recalibration, pack service) is not projected as recovery.
        return SohTrend("RECORDED", round(max(0.0, -slope), 2), len(entries), round(span_days, 1))
    assumed = ASSUMED_SOH_LOSS_PCT_PER_YEAR * (1.0 + (history.stress_score or 0.0) / 100.0)
    return SohTrend("ASSUMED", round(assumed, 2), len(entries), round(span_days, 1))


def project_soh(current_soh: float, loss_pct_per_year: float, years: float) -> float:
    if years == 0:  # unrounded, so "today" matches a /run at the same battery state
        return current_soh
    return round(max(0.0, current_soh - loss_pct_per_year * years), 1)
