from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://promptbase:promptbase@db:5432/promptbase"
    redis_url: str = "redis://redis:6379/0"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    upload_dir: str = "/app/uploads"
    max_upload_size_mb: int = 50

    rag_threshold_tokens: int = 8000
    default_chunk_size: int = 500
    default_chunk_overlap: int = 50
    default_top_k: int = 5

    ocr_service_url: str = ""

    anthropic_api_key: str = ""
    openai_api_key: str = ""
    openrouter_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
