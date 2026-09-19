"""Privacy/abuse hardening as pure-ASGI middleware (stdlib + Starlette only).

* SecurityHeadersMiddleware: no-store + nosniff + no-referrer + restrictive Permissions-Policy on every response, and a
  catch-all that logs only the error TYPE (never a message/traceback, which could echo user content) and answers a generic 500.
* BodyLimitMiddleware: per-path request-body caps enforced on Content-Length AND on the streamed bytes (413).
* RateLimitMiddleware: in-memory sliding window per client IP for the expensive endpoints (429 + Retry-After). Nothing is
  persisted; the IP only lives in process memory for at most one window.
* AccessLogPrivacyFilter: strips query strings and client addresses from uvicorn's access log.

Limits are deliberately generous (a demo run makes a handful of calls); they exist to stop scripted abuse, not people.
"""
import json
import logging
import threading
import time
from collections import deque

from starlette.types import ASGIApp, Message, Receive, Scope, Send

log = logging.getLogger("strokeshield.security")

# --- request body caps (bytes). Keys are exact paths; anything else gets DEFAULT_BODY_LIMIT. ---
DEFAULT_BODY_LIMIT = 64 * 1024  # alert/health/agent JSON is a few KB
BODY_LIMITS: dict[str, int] = {
    "/api/speech/analyze": 5 * 1024 * 1024 + 64 * 1024,  # matches backend.routers.speech (5 MB clip + multipart overhead)
    "/api/vision/second-opinion": 2 * 1024 * 1024,  # the client sends <= 4 small (~50 KB) JPEGs
}

# --- rate limits: path -> (max requests, window seconds) per client IP. Generous on purpose. ---
RATE_LIMITS: dict[str, tuple[int, float]] = {
    "/api/speech/analyze": (30, 60.0),
    "/api/vision/second-opinion": (30, 60.0),
    "/api/agent/signed-url": (20, 60.0),
    "/api/alert": (10, 60.0),
}
MAX_TRACKED_KEYS = 10_000  # bound memory if someone sprays requests from many addresses

PERMISSIONS_POLICY = (
    "accelerometer=(), autoplay=(), camera=(), display-capture=(), geolocation=(), gyroscope=(), magnetometer=(), "
    "microphone=(), midi=(), payment=(), usb=(), interest-cohort=()"
)

_MANAGED = {b"cache-control", b"x-content-type-options", b"referrer-policy", b"x-frame-options", b"permissions-policy"}


async def _send_json(send: Send, status: int, body: dict, extra_headers: list[tuple[bytes, bytes]] | None = None) -> None:
    payload = json.dumps(body).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(payload)).encode())]
    await send({"type": "http.response.start", "status": status, "headers": headers + (extra_headers or [])})
    await send({"type": "http.response.body", "body": payload})


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        is_api = scope["path"].startswith("/api")
        started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = [(k, v) for k, v in message.get("headers", []) if k.lower() not in _MANAGED]
                headers += [
                    (b"cache-control", b"no-store"),
                    (b"x-content-type-options", b"nosniff"),
                    (b"referrer-policy", b"no-referrer"),
                    (b"x-frame-options", b"DENY"),
                    (b"permissions-policy", PERMISSIONS_POLICY.encode()),
                ]
                if is_api:
                    headers.append((b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"))
                message = {**message, "headers": headers}
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:  # noqa: BLE001 - last-resort guard; keeps user content out of logs and responses
            log.error("unhandled error on %s (%s)", scope["path"], type(exc).__name__)
            if not started:
                await _send_json(send_wrapper, 500, {"detail": "internal error"})


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        cap = BODY_LIMITS.get(scope["path"], DEFAULT_BODY_LIMIT)
        declared = dict(scope["headers"]).get(b"content-length", b"")
        if declared.isdigit() and int(declared) > cap:
            await _send_json(send, 413, {"detail": "request too large"})
            return

        seen = 0
        started = False  # the app began a response
        rejected = False  # we answered 413 ourselves; anything the app sends afterwards is dropped

        async def limited_receive() -> Message:
            nonlocal seen, rejected
            message = await receive()
            if message["type"] == "http.request" and not rejected:
                seen += len(message.get("body", b""))
                if seen > cap:
                    # FastAPI turns a failing body read into its own 400, so answer here and tell the app the client is gone.
                    rejected = True
                    if not started:
                        await _send_json(send, 413, {"detail": "request too large"})
                    return {"type": "http.disconnect"}
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal started
            if rejected:
                return
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        await self.app(scope, limited_receive, tracking_send)


class RateLimiter:
    """Sliding-window counter. Thread-safe; state is process memory only."""

    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def check(self, client: str, path: str, limit: int, window: float, now: float | None = None) -> float:
        """0.0 if allowed (and counted); otherwise the seconds until a slot frees up."""
        now = time.monotonic() if now is None else now
        key = (client, path)
        with self._lock:
            if len(self._hits) >= MAX_TRACKED_KEYS and key not in self._hits:
                self._prune(now, window)
                if len(self._hits) >= MAX_TRACKED_KEYS:
                    self._hits.clear()  # under a spray the limiter fails open rather than growing without bound
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= window:
                hits.popleft()
            if len(hits) >= limit:
                return max(window - (now - hits[0]), 0.1)
            hits.append(now)
            return 0.0

    def _prune(self, now: float, window: float) -> None:
        for k in [k for k, h in self._hits.items() if not h or now - h[-1] >= window]:
            del self._hits[k]


limiter = RateLimiter()


class RateLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        rule = RATE_LIMITS.get(scope["path"]) if scope["type"] == "http" else None
        if rule is None or scope["method"] == "OPTIONS":  # CORS preflights are free
            await self.app(scope, receive, send)
            return
        client = (scope.get("client") or ("unknown", 0))[0]
        wait = limiter.check(client, scope["path"], rule[0], rule[1])
        if wait > 0:
            retry = int(wait) + 1
            log.info("rate limited %s", scope["path"])  # no client address in logs
            await _send_json(
                send, 429, {"detail": f"too many requests, try again in {retry} s"}, [(b"retry-after", str(retry).encode())]
            )
            return
        await self.app(scope, receive, send)


class AccessLogPrivacyFilter(logging.Filter):
    """uvicorn.access args are (client_addr, method, full_path, http_version, status). Drop the address and query string."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) == 5:
            _client, method, path, version, status = args
            record.args = ("-", method, str(path).split("?", 1)[0], version, status)
        return True


def install_log_privacy() -> None:
    access = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, AccessLogPrivacyFilter) for f in access.filters):
        access.addFilter(AccessLogPrivacyFilter())
    for name in ("httpx", "httpcore"):  # their INFO lines carry full outbound URLs (agent id, model)
        logging.getLogger(name).setLevel(logging.WARNING)
