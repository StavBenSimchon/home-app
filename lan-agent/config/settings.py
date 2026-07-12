import os


class Settings:
    GATEWAY_URL: str = os.getenv("GATEWAY_URL", "ws://localhost:8080/ws")
    LOCAL_URL: str = os.getenv("LOCAL_URL", "http://localhost:3000")
    AGENT_ID: str = os.getenv("AGENT_ID", "")
    AGENT_TOKEN: str = os.getenv("AGENT_TOKEN", "")
    RECONNECT_DELAY: int = int(os.getenv("RECONNECT_DELAY", "5"))
    MAX_RECONNECT_DELAY: int = int(os.getenv("MAX_RECONNECT_DELAY", "60"))
    REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", "60"))
