from typing import Literal

from pydantic import BaseModel, Field


class SimulationRequest(BaseModel):
    vehicle_id: str = Field(..., description="Selected vehicle ID")
    route_distance_km: float = Field(..., gt=0, description="Total route distance in km")
    elevation_gain_m: float = Field(
        default=0.0, ge=0, description="Total elevation climb in meters"
    )
    ambient_temp_c: float = Field(default=25.0, description="Ambient temperature in °C")
    payload_kg: float = Field(default=0.0, ge=0, description="Cargo/passenger payload in kg")
    hvac_mode: Literal["OFF", "LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM")
    driving_style: Literal["ECO", "NORMAL", "AGGRESSIVE"] = Field(default="NORMAL")
    regen_level: Literal["OFF", "LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM")
    reserve_soc_target_pct: float = Field(
        default=15.0, ge=0, le=50, description="Target arrival SOC reserve (%)"
    )


class SimulationResponse(BaseModel):
    vehicle_id: str
    usable_battery_capacity_kwh: float
    estimated_energy_consumption_kwh: float
    projected_arrival_soc_pct: float
    remaining_range_km: float
    risk_level: Literal["SAFE", "CAUTION", "NOT_RECOMMENDED"]
    confidence_score_pct: float
    recommendations: list[str]

class SimulationRecord(BaseModel):
    """A stored simulation run — request + result, for history lookups."""
    id: str = Field(default_factory=lambda: str(uuid4()))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    request: SimulationRequest
    response: SimulationResponse


class BatchSimulationRequest(BaseModel):
    """Run the same route/conditions against multiple vehicles (or the whole fleet)."""
    vehicle_ids: list[str] | None = Field(
        default=None, description="Vehicles to evaluate; omit to run against the entire fleet"
    )
    route_distance_km: float = Field(..., gt=0)
    elevation_gain_m: float = Field(default=0.0, ge=0)
    ambient_temp_c: float = Field(default=25.0)
    payload_kg: float = Field(default=0.0, ge=0)
    hvac_mode: Literal["OFF", "LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM")
    driving_style: Literal["ECO", "NORMAL", "AGGRESSIVE"] = Field(default="NORMAL")
    regen_level: Literal["OFF", "LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM")
    reserve_soc_target_pct: float = Field(default=15.0, ge=0, le=50)


class BatchSimulationResult(BaseModel):
    vehicle_id: str
    response: SimulationResponse | None = None
    error: str | None = None


class BatchSimulationResponse(BaseModel):
    results: list[BatchSimulationResult]


class SimulationConfig(BaseModel):
    """One named configuration to evaluate in a comparison run."""
    label: str = Field(..., description="Display label for this config, e.g. 'Eco + AC off'")
    hvac_mode: Literal["OFF", "LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM")
    driving_style: Literal["ECO", "NORMAL", "AGGRESSIVE"] = Field(default="NORMAL")
    regen_level: Literal["OFF", "LOW", "MEDIUM", "HIGH"] = Field(default="MEDIUM")


class CompareSimulationRequest(BaseModel):
    vehicle_id: str = Field(..., description="Selected vehicle ID")
    route_distance_km: float = Field(..., gt=0)
    elevation_gain_m: float = Field(default=0.0, ge=0)
    ambient_temp_c: float = Field(default=25.0)
    payload_kg: float = Field(default=0.0, ge=0)
    reserve_soc_target_pct: float = Field(default=15.0, ge=0, le=50)
    configs: list[SimulationConfig] = Field(..., min_length=2, description="Configs to compare")


class CompareResult(BaseModel):
    label: str
    response: SimulationResponse


class CompareSimulationResponse(BaseModel):
    vehicle_id: str
    results: list[CompareResult]