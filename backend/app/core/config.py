from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_PATH: str = str(Path(__file__).resolve().parents[2] / "data" / "fleet.sqlite3")
    PROJECT_NAME: str = "EV Fleet Telematics & RRD Simulation"
    API_V1_STR: str = "/api"
    CORS_ORIGINS: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    model_config = SettingsConfigDict(case_sensitive=True, env_file=".env", extra="ignore")


settings = Settings()
