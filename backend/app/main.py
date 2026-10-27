import logging
import sqlite3
from contextlib import asynccontextmanager
from math import isfinite

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import simulation, telemetry, vehicles
from app.core import fleet_state, persistence
from app.core.config import settings
from app.schemas.simulation import SimulationRecord


@asynccontextmanager
async def lifespan(app: FastAPI):
    with persistence.open_database(settings.DATABASE_PATH, fleet_state.DEMO_FLEET) as db:
        records = [
            SimulationRecord.model_validate_json(payload)
            for (payload,) in db.execute("SELECT payload FROM simulations ORDER BY rowid")
        ]
        with fleet_state.LOCK:
            fleet_state.restore()
            simulation.SIMULATION_HISTORY[:] = records
        yield


app = FastAPI(
    title="EV Fleet Telematics & RRD Simulation API",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError):
    detail = jsonable_encoder(
        exc.errors(), custom_encoder={float: lambda value: value if isfinite(value) else str(value)}
    )
    return JSONResponse(status_code=422, content={"detail": detail})


@app.exception_handler(sqlite3.Error)
async def storage_error(request: Request, exc: sqlite3.Error):
    logging.getLogger(__name__).error("Fleet storage failed", exc_info=exc)
    return JSONResponse(status_code=503, content={"detail": "Fleet storage unavailable"})


# CORS setup for Web & Mobile dev environments
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vehicles.router, prefix="/api/vehicles", tags=["Vehicles"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["Telemetry"])
app.include_router(simulation.router, prefix="/api/simulation", tags=["Simulation"])


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
