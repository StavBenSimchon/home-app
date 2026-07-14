from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://homeapp:homeapp_dev@localhost:5432/homeapp"
    jwt_secret: str = "change-me-in-production"
    jwt_expiry_hours: int = 168  # 7 days

    class Config:
        env_file = ".env"


settings = Settings()
