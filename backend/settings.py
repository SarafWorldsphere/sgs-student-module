from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    database_url: str = Field(alias="DATABASE_URL", min_length=1)
    db_service_slots: int = Field(default=12, alias="DB_SERVICE_SLOTS", ge=1)
    db_pool_reserve: float = Field(default=0.2, alias="DB_POOL_RESERVE", ge=0, lt=1)
    client_name: str = Field(default="SGS", alias="CLIENT_NAME", min_length=1)

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
