from pydantic import BaseModel, Field


class VehicleBase(BaseModel):
    id: str = Field(..., description="Unique vehicle identifier")
    name: str = Field(..., description="Display name / Fleet ID")
    model: str = Field(..., description="Vehicle make and model")
    battery_capacity_kwh: float = Field(..., description="Nominal battery capacity in kWh")
    baseline_efficiency_wh_km: float = Field(..., description="Baseline efficiency in Wh/km")
    current_soc: float = Field(..., ge=0.0, le=100.0, description="Current State of Charge (%)")
    current_soh: float = Field(..., ge=0.0, le=100.0, description="Current State of Health (%)")
    status: str = Field(default="AVAILABLE", description="Vehicle operational status")


class Vehicle(VehicleBase):
    pass

class VehicleCreate(VehicleBase):
    """Payload for registering a new vehicle. All fields required except status."""
    pass


class VehicleUpdate(BaseModel):
    """Payload for partial updates — every field optional."""
    name: str | None = None
    model: str | None = None
    battery_capacity_kwh: float | None = None
    baseline_efficiency_wh_km: float | None = None
    current_soc: float | None = Field(default=None, ge=0.0, le=100.0)
    current_soh: float | None = Field(default=None, ge=0.0, le=100.0)
    status: str | None = None


class VehicleHistoryEntry(BaseModel):
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    current_soc: float
    current_soh: float
    status: str