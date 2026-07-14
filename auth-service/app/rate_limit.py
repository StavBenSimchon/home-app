import time
from collections import defaultdict
from threading import Lock


class RateLimiter:
    def __init__(self, max_requests: int = 5, window_seconds: int = 60):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self._attempts: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def is_rate_limited(self, key: str) -> bool:
        now = time.time()
        with self._lock:
            attempts = self._attempts[key]
            cutoff = now - self.window_seconds
            self._attempts[key] = [t for t in attempts if t > cutoff]

            if len(self._attempts[key]) >= self.max_requests:
                return True

            self._attempts[key].append(now)
            return False

    def reset(self, key: str):
        with self._lock:
            self._attempts.pop(key, None)


login_limiter = RateLimiter(max_requests=5, window_seconds=60)
