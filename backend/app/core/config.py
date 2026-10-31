from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import model_validator
from typing import Optional

class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: Optional[str] = None
    SUPABASE_SERVICE_KEY: Optional[str] = None

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @model_validator(mode="after")
    def validate_and_standardize_credentials(self):
        key = self.SUPABASE_SERVICE_ROLE_KEY or self.SUPABASE_SERVICE_KEY
        if not key or key.strip() in ("", "your-service-role-key", "placeholder"):
            raise ValueError(
                "Missing or invalid configuration for Supabase service role key. "
                "Provide 'SUPABASE_SERVICE_ROLE_KEY' (or 'SUPABASE_SERVICE_KEY') in the environment or .env file."
            )
        self.SUPABASE_SERVICE_ROLE_KEY = key.strip()
        self.SUPABASE_SERVICE_KEY = key.strip()

        if not self.SUPABASE_URL or self.SUPABASE_URL.strip() in ("", "https://your-project.supabase.co", "placeholder"):
            raise ValueError(
                "Missing or invalid configuration for 'SUPABASE_URL'. "
                "Ensure valid credentials are provided in the environment or .env file."
            )
        self.SUPABASE_URL = self.SUPABASE_URL.strip()
        return self

settings = Settings()
