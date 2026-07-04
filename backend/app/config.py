from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://homeapp:homeapp_dev@localhost:5432/homeapp"
    app_name: str = "Home App"
    debug: bool = True
    ai_api_key: str = ""
    ai_model: str = "deepseek-v4-flash-free"
    ai_base_url: str = "https://opencode.ai/zen/v1"

    class Config:
        env_file = ".env"


settings = Settings()
