"""Private HTTP boundary for Hermes. This process has no platform database or send access."""

import hmac
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from uuid import UUID

from runtime import HermesRuntime, RuntimeUnavailable

MAX_BODY = 256_000


def validate_request(value):
    if not isinstance(value, dict) or value.get("version") != 1:
        raise ValueError("invalid version")
    allowed = {"version", "requestId", "workspaceId", "model", "effort", "messages", "maxOutputTokens", "responseSchema"}
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
    return value


def make_server(host, port, key, runtime):
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

        def do_GET(self):
            if self.path != "/health":
                return self.send_json(404, {"error": "NOT_FOUND"})
            self.send_json(200, {"status": "up", "runtime": "hermes", "version": 1})

        def do_POST(self):
            if self.path != "/v1/generate":
                return self.send_json(404, {"error": "NOT_FOUND"})
            authorization = self.headers.get("Authorization", "")
            if not hmac.compare_digest(authorization.encode(), ("Bearer " + key).encode()):
                return self.send_json(401, {"error": "UNAUTHORIZED"})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.send_json(415, {"error": "JSON_REQUIRED"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_BODY or self.headers.get("Transfer-Encoding"):
                    return self.send_json(413, {"error": "BODY_LIMIT"})
                self.connection.settimeout(10)
                request = validate_request(json.loads(self.rfile.read(length)))
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
    server = make_server("127.0.0.1", int(os.environ.get("HERMES_BRIDGE_PORT", "8788")), key, runtime)
    print("Rapiz Hermes bridge listening on loopback", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
