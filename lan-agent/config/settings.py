import os


class Settings:
    GATEWAY_URL: str = os.getenv("GATEWAY_URL", "wss://localhost:8443/ws")
    AGENT_ID: str = os.getenv("AGENT_ID", "")
    RECONNECT_DELAY: int = int(os.getenv("RECONNECT_DELAY", "5"))
    MAX_RECONNECT_DELAY: int = int(os.getenv("MAX_RECONNECT_DELAY", "60"))
    REQUEST_TIMEOUT: int = int(os.getenv("REQUEST_TIMEOUT", "60"))

    CERT_FILE: str = os.getenv("CERT_FILE", "")
    KEY_FILE: str = os.getenv("KEY_FILE", "")
    CA_FILE: str = os.getenv("CA_FILE", "")

    @property
    def services(self) -> dict[str, str]:
        result = {}
        for key, val in os.environ.items():
            if key.startswith("SERVICE_"):
                name = key[len("SERVICE_"):].lower().replace("_", "-")
                result[name] = val
        return result
