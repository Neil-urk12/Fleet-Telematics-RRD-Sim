from datetime import datetime

from pydantic import BaseModel, Field


class TelemetryEvent(BaseModel):
    vehicle_id: str = Field(..., description="Target vehicle ID")
    timestamp: datetime = Field(default_factory=datetime.utcnow)
    soc: float = Field(..., ge=0.0, le=100.0, description="State of Charge (%)")
    soh: float = Field(..., ge=0.0, le=100.0, description="State of Health (%)")
    speed_kph: float = Field(..., ge=0.0, description="Current speed in km/h")
    odometer_km: float = Field(..., ge=0.0, description="Odometer reading in km")
    ambient_temp_c: float = Field(..., description="Ambient temperature in °C")
    pack_temp_c: float = Field(..., description="Battery pack temperature in °C")
    latitude: float | None = None
    longitude: float | None = None


class TelemetryResponse(BaseModel):
    success: bool
    message: str
    data: TelemetryEvent | None = None


class BatchTelemetryRequest(BaseModel):
    events: list[TelemetryEvent] = Field(..., min_length=1, description="Telemetry snapshots to ingest")


class BatchTelemetryResult(BaseModel):
    vehicle_id: str
    success: bool
    message: str


class BatchTelemetryResponse(BaseModel):
    results: list[BatchTelemetryResult]


class FleetTelemetryResponse(BaseModel):
    success: bool
    message: str
    data: dict[str, TelemetryEvent]