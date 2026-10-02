from datetime import UTC, datetime, timedelta

from pydantic import BaseModel, Field, field_validator

MAX_FUTURE_CLOCK_SKEW = timedelta(minutes=5)


class TelemetryEvent(BaseModel):
    vehicle_id: str = Field(..., description="Target vehicle ID")
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    soc: float = Field(..., ge=0.0, le=100.0, description="State of Charge (%)")
    soh: float = Field(..., ge=0.0, le=100.0, description="State of Health (%)")
    speed_kph: float = Field(..., ge=0.0, description="Current speed in km/h")
    odometer_km: float = Field(..., ge=0.0, description="Odometer reading in km")
    ambient_temp_c: float = Field(..., description="Ambient temperature in °C")
    pack_temp_c: float = Field(..., description="Battery pack temperature in °C")
    latitude: float | None = None
    longitude: float | None = None

    @field_validator("timestamp")
    @classmethod
    def normalize_timestamp(cls, value: datetime) -> datetime:
        """Normalize to UTC and reject readings beyond the allowed clock skew."""
        if value.tzinfo is None:
            value = value.replace(tzinfo=UTC)
        else:
            value = value.astimezone(UTC)
        if value > datetime.now(UTC) + MAX_FUTURE_CLOCK_SKEW:
            raise ValueError("Telemetry timestamp must not be more than 5 minutes in the future")
        return value


class TelemetryResponse(BaseModel):
    success: bool
    message: str
    data: TelemetryEvent | None = None


class BatchTelemetryRequest(BaseModel):
    events: list[TelemetryEvent] = Field(
        ..., min_length=1, description="Telemetry snapshots to ingest"
    )


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
