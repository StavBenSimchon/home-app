import asyncio
import json
import logging
import ssl
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
        self.services = settings.services
        self.ssl_ctx = self._build_ssl_context()

    def _build_ssl_context(self) -> ssl.SSLContext | None:
        if not self.s.CERT_FILE or not self.s.KEY_FILE:
            log.warning("no client cert configured — mTLS disabled")
            return None

        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)

        if self.s.CA_FILE:
            ctx.load_verify_locations(self.s.CA_FILE)
            log.info("loaded ca cert: %s", self.s.CA_FILE)
        else:
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            log.warning("no ca cert — gateway cert will not be verified")

        ctx.load_cert_chain(certfile=self.s.CERT_FILE, keyfile=self.s.KEY_FILE)
        log.info("mTLS enabled: cert=%s", self.s.CERT_FILE)
        return ctx

    async def start(self):
        log.info("starting lan agent: %s", self.agent_id)
        log.info("services: %s", {k: v for k, v in self.services.items()})
        while True:
            try:
                await self._connect()
            except Exception as e:
                log.error("connection lost: %s — reconnecting in %ds", e, self.delay)
                await asyncio.sleep(self.delay)
                self.delay = min(self.delay * 2, self.s.MAX_RECONNECT_DELAY)

    async def _connect(self):
        headers = {"X-Agent-ID": self.agent_id}

        log.info("connecting to %s", self.s.GATEWAY_URL)
        async with websockets.connect(
            self.s.GATEWAY_URL,
            additional_headers=headers,
            ssl=self.ssl_ctx,
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
        service = data.get("service", "")

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
        log.info("%s %s → service:%s → %d", data["method"], data["path"], service, resp["status"])

    async def _forward(self, req: dict) -> dict:
        service = req.get("service", "")
        base_url = self.services.get(service)

        if not base_url:
            return {
                "id": req["id"],
                "status": 404,
                "headers": {"Content-Type": "application/json"},
                "body": list(json.dumps({"error": f"unknown service: {service}"}).encode()),
            }

        path = req.get("path", "/")
        if not path.startswith("/"):
            path = "/" + path

        url = f"{base_url}{path}"
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
