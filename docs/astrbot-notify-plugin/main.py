# WHL 俱乐部运营平台通知接收插件（TECH_DESIGN §12）。
#
# 协议（照抄竞猜 docs/astrbot-sync-api.md 签名契约）：
#   POST /notify，头 X-Timestamp / X-Sign =
#   hex(HMAC-SHA256(SECRET, "POST|/notify|秒级ts|rawBody"))，时钟窗 ±300 秒。
#   消息体 {"qq": "...", "template": "...", "text": "..."}——文本平台侧已渲染好，直接发私信。
#
# 与赛事/竞猜的对接插件相互独立：独立端口、独立密钥、独立命令域。

import hashlib
import hmac
import json
import time

import aiohttp
from aiohttp import web

from astrbot.api import logger
from astrbot.api.event import MessageChain
from astrbot.api.platform import MessageType

SIGN_HEADER = "X-Sign"
TS_HEADER = "X-Timestamp"
SIGN_WINDOW_SECONDS = 300


def _verify(secret: str, body: bytes, ts_header, sign_header) -> bool:
    """入站验签：任何缺失/格式错误/超窗/不匹配一律 False（常数时间比较）。"""
    if not secret or not ts_header or not sign_header:
        return False
    try:
        ts = int(str(ts_header).strip())
    except (TypeError, ValueError):
        return False
    if abs(int(time.time()) - ts) > SIGN_WINDOW_SECONDS:
        return False
    canonical = f"POST|/notify|{ts}|".encode("utf-8") + body
    expected = hmac.new(secret.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, str(sign_header).strip().lower())


class WhlClubNotifyPlugin:
    def __init__(self, context):
        self.context = context
        self.config = context.config
        self._runner: web.AppRunner | None = None

    def _cfg(self, key, default=None):
        return self.config.get(key, default)

    def _enabled(self) -> bool:
        if not self._cfg("notify_enabled", False):
            return False
        if not str(self._cfg("sync_secret") or "").strip():
            logger.warning("[whl-club-notify] notify_enabled 已开但 sync_secret 为空，不生效")
            return False
        return True

    # ─── HTTP 服务端 ──────────────────────────────────────

    async def start(self):
        if not self._enabled():
            logger.info("[whl-club-notify] disabled, http server not started")
            return
        host = str(self._cfg("notify_listen_host", "127.0.0.1"))
        try:
            port = int(self._cfg("notify_listen_port", 9992))
        except (TypeError, ValueError):
            port = 9992
        app = web.Application()
        app.router.add_post("/notify", self._http_notify)
        self._runner = web.AppRunner(app, access_log=None)
        await self._runner.setup()
        try:
            await web.TCPSite(self._runner, host, port).start()
        except OSError as e:
            logger.error(f"[whl-club-notify] listen {host}:{port} failed: {e}")
            await self._runner.cleanup()
            self._runner = None
            return
        logger.info(f"[whl-club-notify] listening on {host}:{port}")

    async def terminate(self):
        if self._runner:
            await self._runner.cleanup()
            self._runner = None

    async def _http_notify(self, request: web.Request) -> web.Response:
        raw = await request.read()
        secret = str(self._cfg("sync_secret") or "")
        if not _verify(secret, raw, request.headers.get(TS_HEADER), request.headers.get(SIGN_HEADER)):
            return web.json_response({"error": "bad sign"}, status=401)
        try:
            body = json.loads(raw)
            qq = str(body["qq"]).strip()
            text = str(body["text"])
        except (json.JSONDecodeError, KeyError, TypeError):
            return web.json_response({"error": "bad request"}, status=400)
        if not qq or not text:
            return web.json_response({"error": "bad request"}, status=400)
        sent = await self._send_to_qq(qq, text)
        if not sent:
            # 平台侧把非 200 视为失败留 pending 重试；这里 503 让下轮 cron 再投
            return web.json_response({"error": "send failed"}, status=503)
        return web.json_response({"ok": True})

    # ─── QQ 私信 ─────────────────────────────────────────

    def _origin_for(self, qq: str) -> str:
        configured = str(self._cfg("notify_platform_id") or "").strip()
        if configured:
            return f"{configured}:{MessageType.PRIVATE_MESSAGE.value}:{qq}"
        insts = getattr(getattr(self.context, "platform_manager", None), "platform_insts", None) or []
        for inst in insts:
            pid = getattr(getattr(inst, "meta", lambda: None)(), "id", None)
            if pid:
                return f"{pid}:{MessageType.PRIVATE_MESSAGE.value}:{qq}"
        return f"aiocqhttp:{MessageType.PRIVATE_MESSAGE.value}:{qq}"

    async def _send_to_qq(self, qq: str, text: str) -> bool:
        try:
            return bool(
                await self.context.send_message(self._origin_for(qq), MessageChain().message(text))
            )
        except Exception as e:  # 平台实例掉线等——留给平台侧 cron 重试
            logger.warning(f"[whl-club-notify] send to {qq} error: {e}")
            return False
