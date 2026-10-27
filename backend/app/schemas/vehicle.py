from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

BatteryStateSource = Literal["telemetry", "vehicle_defaults", "manual"]


class VehicleBase(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)

    id: str = Field(..., description="Unique vehicle identifier")
    name: str = Field(..., description="Display name / Fleet ID")
    model: str = Field(..., description="Vehicle make and model")
    battery_capacity_kwh: float = Field(..., description="Nominal battery capacity in kWh")
    baseline_efficiency_wh_km: float = Field(..., description="Baseline efficiency in Wh/km")
    curb_mass_kg: float = Field(
        default=2500.0, gt=0, allow_inf_nan=False, description="Unloaded vehicle mass in kg"
    )
    regen_efficiency: float = Field(
        default=0.60,
        ge=0,
        le=1,
        allow_inf_nan=False,
        description="Fraction of descent potential energy recoverable at HIGH regen",
    )
    cycle_count: int | None = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
        description="Reported equivalent full charge cycles; null when the history is unknown",
    )
    avg_dod_pct: float | None = Field(
        default=None,
        ge=0,
        le=100,
        allow_inf_nan=False,
        description="Reported average depth of discharge (%); null when unknown",
    )
    fast_charge_share_pct: float | None = Field(
        default=None,
        ge=0,
        le=100,
        allow_inf_nan=False,
        description="Reported share of charging energy from DC fast charging (%); unknown if null",
    )
    thermal_stress_index: float | None = Field(
        default=None,
        ge=0,
        le=100,
        allow_inf_nan=False,
        description="Reported thermal stress index (0-100); null when unknown",
    )
    current_soc: float = Field(..., ge=0.0, le=100.0, description="Current State of Charge (%)")
    current_soh: float = Field(..., ge=0.0, le=100.0, description="Current State of Health (%)")
    status: str = Field(default="AVAILABLE", description="Vehicle operational status")


class BatteryHistory(BaseModel):
    """Derived operational-history stress assessment."""

    stress_score: float | None = Field(
        default=None, description="History stress score (0-100); null when no history is reported"
    )
    stress_class: Literal["NORMAL", "ELEVATED", "HIGH"] | None = Field(
        default=None, description="History stress classification; null when no history is reported"
    )
    capacity_factor: float = Field(
        default=1.0, description="Multiplier applied to the SOH-adjusted usable capacity"
    )


class Vehicle(VehicleBase):
    state_source: BatteryStateSource = "vehicle_defaults"
    state_timestamp: datetime | None = None


class VehicleWithHistory(Vehicle):
    """Vehicle response including its derived operational-history assessment."""

    battery_history: BatteryHistory


class VehicleCreate(VehicleBase):
    """Vehicle registration with default status, mass, and regenerative efficiency."""

    pass


class VehicleUpdate(BaseModel):
    """Payload for partial updates — every field optional."""

    model_config = ConfigDict(allow_inf_nan=False)

    name: str | None = None
    model: str | None = None
    battery_capacity_kwh: float | None = None
    baseline_efficiency_wh_km: float | None = None
    curb_mass_kg: float | None = Field(default=None, gt=0, allow_inf_nan=False)
    regen_efficiency: float | None = Field(default=None, ge=0, le=1, allow_inf_nan=False)
    cycle_count: int | None = Field(default=None, ge=0, allow_inf_nan=False)
    avg_dod_pct: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    fast_charge_share_pct: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    thermal_stress_index: float | None = Field(default=None, ge=0, le=100, allow_inf_nan=False)
    current_soc: float | None = Field(default=None, ge=0.0, le=100.0)
    current_soh: float | None = Field(default=None, ge=0.0, le=100.0)
    status: str | None = None


class VehicleHistoryEntry(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    current_soc: float
    current_soh: float
    status: str
