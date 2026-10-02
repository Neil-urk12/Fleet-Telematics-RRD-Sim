"""Run with: cd backend && uv run python check_telemetry.py"""

from datetime import UTC

from fastapi import HTTPException
from pydantic import ValidationError

from app.api import telemetry
from app.core import fleet_state
from app.schemas.telemetry import BatchTelemetryRequest, TelemetryEvent


def main() -> None:
    fleet_state.LATEST_TELEMETRY.clear()
    fleet_state.TELEMETRY_HISTORY.clear()
    base = {
        "vehicle_id": "EV-001",
        "soh": 95,
        "speed_kph": 0,
        "odometer_km": 12500,
        "ambient_temp_c": 22,
        "pack_temp_c": 25,
    }
    newer = dict(base, timestamp="2020-01-01T13:00:00Z", soc=90)
    older = dict(base, timestamp="2020-01-01T11:00:00", soc=20)
    other = dict(newer, vehicle_id="EV-002", soc=70)
    result = telemetry.ingest_batch_telemetry(BatchTelemetryRequest(events=[newer, older, other]))
    assert [item.vehicle_id for item in result.results] == ["EV-001", "EV-001", "EV-002"]
    assert all(item.success for item in result.results)
    assert telemetry.get_latest_telemetry("EV-001").data.soc == 90
    assert telemetry.get_fleet_latest_telemetry().data["EV-001"].soc == 90
    assert telemetry.get_fleet_latest_telemetry().data["EV-002"].soc == 70
    assert [event.soc for event in telemetry.get_telemetry_history("EV-001")] == [90, 20]
    assert telemetry.get_latest_telemetry("EV-003").data is None
    try:
        telemetry.get_telemetry_history("unknown")
    except HTTPException as exc:
        assert exc.status_code == 404
    else:
        raise AssertionError("Unknown vehicle history was accepted")

    latest_before = fleet_state.LATEST_TELEMETRY.copy()
    history_before = {key: list(events) for key, events in fleet_state.TELEMETRY_HISTORY.items()}
    for events in ([], [newer, dict(older, soc=101)], [newer, {"vehicle_id": "EV-003"}]):
        try:
            telemetry.ingest_batch_telemetry(BatchTelemetryRequest(events=events))
        except ValidationError:
            pass
        else:
            raise AssertionError("Invalid batch was accepted")
        assert fleet_state.LATEST_TELEMETRY == latest_before
        assert fleet_state.TELEMETRY_HISTORY == history_before

    # 14:00 +02:00 is older than 13:00 UTC, despite its larger wall-clock hour.
    telemetry.ingest_telemetry(
        TelemetryEvent(**dict(base, timestamp="2020-01-01T14:00:00+02:00", soc=30))
    )
    assert telemetry.get_latest_telemetry("EV-001").data.soc == 90
    telemetry.ingest_telemetry(
        TelemetryEvent(**dict(base, timestamp="2020-01-01T14:00:00", soc=80))
    )
    assert telemetry.get_latest_telemetry("EV-001").data.soc == 80
    # Equal timestamps retain the existing last-ingested-wins behavior.
    telemetry.ingest_telemetry(
        TelemetryEvent(**dict(base, timestamp="2020-01-01T14:00:00Z", soc=75))
    )
    assert telemetry.get_fleet_latest_telemetry().data["EV-001"].soc == 75
    assert [event.soc for event in telemetry.get_telemetry_history("EV-001")] == [
        90,
        20,
        30,
        80,
        75,
    ]
    assert TelemetryEvent(**dict(base, soc=50)).timestamp.tzinfo is UTC
    print("Telemetry checks passed: validation, history, ordering, and UTC normalization")


if __name__ == "__main__":
    main()
