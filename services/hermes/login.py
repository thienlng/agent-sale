"""ChatGPT device-code sign-in for the private Hermes home, driven by explicit admin clicks.

Mirrors hermes_cli.auth._codex_device_code_login (same OpenAI endpoints and client id) but is
split into start / poll steps so a web UI can show the code and wait, instead of blocking a
terminal. Tokens are written only to this runtime's private ``auth.json`` (mode 600); they never
leave this module through the HTTP API. No login happens during customer turns.
"""

import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

from authstore import AuthStore

ISSUER = "https://auth.openai.com"
CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"  # public Codex CLI OAuth client id used by Hermes
TOKEN_URL = f"{ISSUER}/oauth/token"
VERIFICATION_URL = f"{ISSUER}/codex/device"
MAX_WAIT_SECONDS = 15 * 60
CODEX_URL = "https://chatgpt.com/backend-api/codex"


class LoginError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _http_client():
    import httpx
    return httpx.Client(timeout=httpx.Timeout(15.0))


class ChatGptLogin:
    def __init__(self, home, client_factory=None, clock=time.monotonic):
        self.home = Path(home)
        self.store = AuthStore(self.home)
        self._client_factory = client_factory or _http_client
        self._clock = clock
        self._lock = threading.Lock()
        self._pending = None  # {device_auth_id, user_code, interval, deadline, next_poll}
        self._failed = None

    # -- state -------------------------------------------------------------------------

    def _signed_in(self):
        return self.store.read() is not None

    def status(self):
        """Current state; while pending this also asks OpenAI (at most once per interval)."""
        job = None
        with self._lock:
            pending = self._pending
            if pending and self._clock() >= pending["deadline"]:
                self._pending, self._failed = None, "device_code_timeout"
            elif pending and self._clock() >= pending["next_poll"]:
                pending["next_poll"] = self._clock() + pending["interval"]
                job = dict(pending)
        if job:
            # Network I/O runs outside the lock so logout and other polls never wait behind OpenAI.
            outcome = self._poll(job)
            with self._lock:
                if self._pending is pending:  # not logged out or restarted meanwhile
                    self._apply(outcome)
        with self._lock:
            if self._pending:
                remaining = max(0, int(self._pending["deadline"] - self._clock()))
                expires = datetime.fromtimestamp(time.time() + remaining, timezone.utc)
                return {"state": "pending", "verificationUrl": VERIFICATION_URL,
                        "userCode": self._pending["user_code"],
                        "expiresAt": expires.isoformat().replace("+00:00", "Z")}
            if self._signed_in():
                return {"state": "signed_in"}
            if self._failed:
                return {"state": "failed", "code": self._failed}
            return {"state": "signed_out"}

    def start(self):
        with self._lock:
            reuse = bool(self._pending and self._clock() < self._pending["deadline"])
            if not reuse:
                self._pending, self._failed = None, None
        if not reuse:
            pending = self._request_code()  # network I/O outside the lock
            with self._lock:
                if not (self._pending and self._clock() < self._pending["deadline"]):
                    self._pending = pending  # else a concurrent start won; keep its code
        return self.status()

    def logout(self):
        """Local sign-out: OpenAI offers no documented token-revocation endpoint to this runtime."""
        with self._lock:
            self._pending, self._failed = None, None
            with self.store.lock():
                self.store.delete()
        return {"state": "signed_out"}

    # -- OpenAI steps -----------------------------------------------------------------

    def _request_code(self):
        try:
            with self._client_factory() as client:
                response = client.post(f"{ISSUER}/api/accounts/deviceauth/usercode",
                                       json={"client_id": CLIENT_ID})
        except Exception as error:
            # Only the exception class: messages can carry URLs and request details.
            print(f"ChatGPT sign-in could not reach OpenAI: {type(error).__name__}", file=sys.stderr, flush=True)
            raise LoginError("login_unreachable") from None
        if response.status_code == 429:
            raise LoginError("rate_limited")
        if response.status_code != 200:
            raise LoginError("login_failed")
        try:
            data = response.json()
            user_code, device_auth_id = data["user_code"], data["device_auth_id"]
            interval = max(3, int(data.get("interval") or 5))
        except (ValueError, TypeError, KeyError, AttributeError):
            raise LoginError("login_failed") from None
        if not isinstance(user_code, str) or not isinstance(device_auth_id, str) or not user_code:
            raise LoginError("login_failed")
        now = self._clock()
        return {"device_auth_id": device_auth_id, "user_code": user_code, "interval": interval,
                "deadline": now + MAX_WAIT_SECONDS, "next_poll": now + interval}

    def _poll(self, job):
        """One check with OpenAI: ("wait",), ("fail", code) or ("done", access, refresh). Never raises."""
        try:
            with self._client_factory() as client:
                poll = client.post(f"{ISSUER}/api/accounts/deviceauth/token",
                                   json={"device_auth_id": job["device_auth_id"], "user_code": job["user_code"]})
                if poll.status_code != 200:
                    # 403/404: not approved yet; 429/5xx: OpenAI is busy. Either way try again later.
                    return ("wait",) if poll.status_code in (403, 404, 429) or poll.status_code >= 500 \
                        else ("fail", "login_failed")
                grant = poll.json()
                if not grant.get("authorization_code") or not grant.get("code_verifier"):
                    return ("fail", "login_failed")
                token = client.post(TOKEN_URL, data={
                    "grant_type": "authorization_code", "code": grant["authorization_code"],
                    "redirect_uri": f"{ISSUER}/deviceauth/callback", "client_id": CLIENT_ID,
                    "code_verifier": grant["code_verifier"]})
                if token.status_code == 429:
                    return ("fail", "rate_limited")
                if token.status_code >= 500:
                    return ("wait",)  # the authorization code may still be redeemable
                tokens = token.json() if token.status_code == 200 else {}
                if not tokens.get("access_token") or not tokens.get("refresh_token"):
                    return ("fail", "login_failed")
                return ("done", tokens["access_token"], tokens["refresh_token"])
        except Exception:
            return ("wait",)  # transient network error or unreadable reply

    def _apply(self, outcome):
        if outcome[0] == "wait":
            return
        self._pending = None
        if outcome[0] == "fail":
            self._failed = outcome[1]
            return
        try:
            self._save(outcome[1], outcome[2])
        except OSError:
            self._failed = "login_failed"

    def _save(self, access_token, refresh_token):
        state = {"version": 1, "providers": {"openai-codex": {
            "tokens": {"access_token": access_token, "refresh_token": refresh_token},
            "base_url": CODEX_URL,
            "last_refresh": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "auth_mode": "chatgpt", "source": "device-code"}}}
        with self.store.lock():
            self.store.write(state)
