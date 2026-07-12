import asyncio
import json
import logging
import uuid

import httpx
import websockets

from config.settings import Settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("lan-agent")


class TunnelAgent:
    def __init__(self, settings: Settings):
        self.s = settings
        self.agent_id = settings.AGENT_ID or f"agent-{uuid.uuid4().hex[:8]}"
        self.delay = settings.RECONNECT_DELAY

    async def start(self):
        log.info("starting lan agent: %s", self.agent_id)
        while True:
            try:
                await self._connect()
            except Exception as e:
                log.error("connection lost: %s — reconnecting in %ds", e, self.delay)
                await asyncio.sleep(self.delay)
                self.delay = min(self.delay * 2, self.s.MAX_RECONNECT_DELAY)

    async def _connect(self):
        headers = {"X-Agent-ID": self.agent_id}
        if self.s.AGENT_TOKEN:
            headers["Authorization"] = f"Bearer {self.s.AGENT_TOKEN}"

        log.info("connecting to %s", self.s.GATEWAY_URL)
        async with websockets.connect(
            self.s.GATEWAY_URL,
            additional_headers=headers,
            ping_interval=30,
            ping_timeout=10,
        ) as ws:
            log.info("connected to gateway")
            self.delay = self.s.RECONNECT_DELAY

            async for raw in ws:
                await self._handle_message(ws, raw)

    async def _handle_message(self, ws, raw: str):
        try:
            wrapper = json.loads(raw)
        except json.JSONDecodeError:
            return

        if wrapper.get("type") != "request":
            return

        data = wrapper["data"]
        req_id = data["id"]

        try:
            resp = await self._forward(data)
        except Exception as e:
            log.error("forward error: %s", e)
            resp = {
                "id": req_id,
                "status": 502,
                "headers": {"Content-Type": "application/json"},
                "body": list(json.dumps({"error": str(e)}).encode()),
            }

        await ws.send(json.dumps({"type": "response", "data": resp}))
        log.info("request %s %s → %d", data["method"], data["path"], resp["status"])

    async def _forward(self, req: dict) -> dict:
        url = f"{self.s.LOCAL_URL}{req['path']}"
        headers = {
            k: v for k, v in req.get("headers", {}).items()
            if k.lower() not in ("host", "transfer-encoding", "connection")
        }
        body = bytes(req.get("body", []))

        async with httpx.AsyncClient(verify=False, timeout=self.s.REQUEST_TIMEOUT) as client:
            resp = await client.request(
                method=req["method"],
                url=url,
                headers=headers,
                content=body if body else None,
            )

            return {
                "id": req["id"],
                "status": resp.status_code,
                "headers": dict(resp.headers),
                "body": list(resp.content),
            }
