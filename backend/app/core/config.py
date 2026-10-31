import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import field_validator

class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_SERVICE_KEY: str
    SUPABASE_JWT_SECRET: str = ""
    ENVIRONMENT: str = "development"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @field_validator("SUPABASE_URL", "SUPABASE_SERVICE_KEY")
    @classmethod
    def validate_non_empty(cls, value: str, info):
        if not value or not value.strip() or "your-project" in value or "placeholder" in value:
            raise ValueError(
                f"Missing or invalid configuration for '{info.field_name}'. "
                "Ensure valid credentials are provided in the environment or .env file."
            )
        return value.strip()

try:
    settings = Settings()
except Exception as exc:
    raise RuntimeError(
        f"Critical startup configuration failure: {exc}"
    ) from exc
