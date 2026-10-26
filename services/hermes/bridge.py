"""Private HTTP boundary for Hermes. This process has no platform database or send access."""

import base64
import binascii
import hmac
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID

from login import ChatGptLogin, LoginError
from runtime import HermesRuntime, RuntimeUnavailable

MAX_BODY = 256_000  # text-only requests, and the non-image part of an image request
MAX_IMAGES = 3
MAX_IMAGE_BYTES = 3_000_000  # decoded, per image
MAX_IMAGES_TOTAL_BYTES = 6_000_000  # decoded, all images of one request
# base64 inflates by 4/3; the slack covers the JSON around it.
MAX_IMAGE_BODY = MAX_BODY + MAX_IMAGES_TOTAL_BYTES * 4 // 3 + 4_096
IMAGE_MAGIC = {
    "image/jpeg": lambda b: b.startswith(b"\xff\xd8\xff"),
    "image/png": lambda b: b.startswith(b"\x89PNG\r\n\x1a\n"),
    "image/webp": lambda b: len(b) > 12 and b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}


def validate_images(images):
    """Customer images for the last user message. The bridge never fetches URLs; it only decodes.

    Returns the list unchanged after checking count, mime allowlist, strict base64, size caps and
    that the bytes really start like the declared type. Any violation raises ValueError (HTTP 400).
    """
    if not isinstance(images, list) or not 1 <= len(images) <= MAX_IMAGES:
        raise ValueError("invalid images")
    total = 0
    for image in images:
        if (not isinstance(image, dict) or set(image) != {"mimeType", "base64"}
                or image["mimeType"] not in IMAGE_MAGIC or not isinstance(image["base64"], str)
                or not image["base64"] or len(image["base64"]) > MAX_IMAGE_BYTES * 4 // 3 + 8):
            raise ValueError("invalid image")
        try:
            raw = base64.b64decode(image["base64"], validate=True)
        except (binascii.Error, ValueError):
            raise ValueError("invalid image encoding") from None
        if not raw or len(raw) > MAX_IMAGE_BYTES or not IMAGE_MAGIC[image["mimeType"]](raw):
            raise ValueError("invalid image content")
        total += len(raw)
        if total > MAX_IMAGES_TOTAL_BYTES:
            raise ValueError("images too large")
    return images


def validate_request(value):
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("invalid version")
    allowed = {"version", "requestId", "workspaceId", "model", "effort", "messages", "maxOutputTokens", "responseSchema",
               "images"}
    if set(value) - allowed:
        raise ValueError("unknown request fields")
    for field in ("requestId", "workspaceId"):
        if not isinstance(value.get(field), str):
            raise ValueError("invalid identity")
        UUID(value[field])
    if not isinstance(value.get("model"), str) or not 1 <= len(value["model"]) <= 200:
        raise ValueError("invalid model")
    if value.get("effort") not in (None, "low", "medium", "high"):
        raise ValueError("invalid effort")
    cap = value.get("maxOutputTokens", 2000)
    if type(cap) is not int or not 1 <= cap <= 8000:
        raise ValueError("invalid output cap")
    messages = value.get("messages")
    if not isinstance(messages, list) or not 1 <= len(messages) <= 42:
        raise ValueError("invalid messages")
    for message in messages:
        if (not isinstance(message, dict) or set(message) != {"role", "content"}
                or message["role"] not in ("system", "user", "assistant")
                or not isinstance(message["content"], str) or not 1 <= len(message["content"]) <= 80_000):
            raise ValueError("invalid message")
    if messages[-1]["role"] != "user":
        raise ValueError("last turn must be user")
    if value.get("responseSchema") is not None and not isinstance(value["responseSchema"], dict):
        raise ValueError("invalid response schema")
    if value.get("images") is not None:
        validate_images(value["images"])
    return value


def make_server(host, port, key, runtime, login=None):
    if len(key) < 32:
        raise ValueError("HERMES_BRIDGE_KEY must contain at least 32 characters")
    gate = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            # Default HTTP logging includes request URLs and upstream errors.
            return

        def send_json(self, status, body):
            encoded = json.dumps(body, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(encoded)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            try:
                self.wfile.write(encoded)
            except (BrokenPipeError, ConnectionResetError):
                return

        def authorized(self):
            authorization = self.headers.get("Authorization", "")
            if hmac.compare_digest(authorization.encode(), ("Bearer " + key).encode()):
                return True
            self.send_json(401, {"error": "UNAUTHORIZED"})
            return False

        def auth_route(self, action, bodyless=False):
            """Admin-driven ChatGPT sign-in; the response never contains tokens."""
            if login is None:
                return self.send_json(404, {"error": "NOT_FOUND"})
            if not self.authorized():
                return
            if bodyless and (self.headers.get("Transfer-Encoding") or self.headers.get("Content-Length", "0").strip() != "0"):
                return self.send_json(400, {"error": "INVALID_REQUEST"})
            try:
                self.send_json(200, action())
            except LoginError as error:
                self.send_json(429 if error.code == "rate_limited" else 503, {"error": error.code})
            except Exception:
                self.send_json(503, {"error": "login_failed"})

        def do_GET(self):
            if self.path == "/v1/auth/status":
                return self.auth_route(lambda: login.status())
            if self.path == "/v1/models":
                if not self.authorized():
                    return
                try:
                    return self.send_json(200, {"version": 1, "models": [{"id": m} for m in runtime.models()]})
                except RuntimeUnavailable as error:
                    return self.send_json(503, {"error": error.code})
                except Exception:
                    return self.send_json(502, {"error": "RUNTIME_FAILED"})
            if self.path != "/health":
                return self.send_json(404, {"error": "NOT_FOUND"})
            self.send_json(200, {"status": "up", "runtime": "hermes", "version": 1})

        def do_POST(self):
            if self.path == "/v1/auth/start":
                return self.auth_route(lambda: login.start(), bodyless=True)
            if self.path == "/v1/auth/logout":
                return self.auth_route(lambda: login.logout(), bodyless=True)
            if self.path != "/v1/generate":
                return self.send_json(404, {"error": "NOT_FOUND"})
            if not self.authorized():
                return
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.send_json(415, {"error": "JSON_REQUIRED"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_IMAGE_BODY or self.headers.get("Transfer-Encoding"):
                    return self.send_json(413, {"error": "BODY_LIMIT"})
                # Only a body beyond the text cap can be an image request; it gets a longer read.
                self.connection.settimeout(10 if length <= MAX_BODY else 30)
                raw = self.rfile.read(length)
                request = validate_request(json.loads(raw))
                if length > MAX_BODY:
                    image_chars = sum(len(i["base64"]) for i in request.get("images") or [])
                    if length - image_chars > MAX_BODY:
                        return self.send_json(413, {"error": "BODY_LIMIT"})
            except (ValueError, TypeError, KeyError, OSError):
                return self.send_json(400, {"error": "INVALID_REQUEST"})
            if not gate.acquire(blocking=False):
                return self.send_json(429, {"error": "RUNTIME_BUSY"})
            try:
                self.send_json(200, runtime.generate(request))
            except RuntimeUnavailable as error:
                self.send_json(503, {"error": error.code})
            except Exception:
                # Exception text may include provider credentials or customer context.
                self.send_json(502, {"error": "RUNTIME_FAILED"})
            finally:
                gate.release()

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server


def main():
    logging.disable(logging.INFO)
    key = os.environ.get("HERMES_BRIDGE_KEY", "")
    home = Path(os.environ.get("RAPIZ_HERMES_HOME", "var/hermes-home"))
    runtime = HermesRuntime(home, os.environ.get("RAPIZ_HERMES_PROVIDER", "openai-codex"))
    server = make_server("127.0.0.1", int(os.environ.get("HERMES_BRIDGE_PORT", "8788")), key, runtime,
                         ChatGptLogin(runtime.home) if runtime.provider == "openai-codex" else None)
    threading.Thread(target=runtime.warm_up, daemon=True).start()
    print("Rapiz Hermes bridge listening on loopback", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
