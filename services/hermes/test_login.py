import json
import os
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from bridge import make_server
from login import ChatGptLogin, LoginError


class FakeResponse:
    def __init__(self, status, body=None):
        self.status_code, self._body = status, body or {}

    def json(self):
        return self._body


class FakeOpenAI:
    """Stands in for auth.openai.com: records calls and replays scripted answers."""

    def __init__(self, polls=(), token=None, code_status=200):
        self.polls, self.token, self.code_status, self.calls = list(polls), token, code_status, []

    def __call__(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def post(self, url, **kwargs):
        self.calls.append(url)
        if url.endswith("/usercode"):
            return FakeResponse(self.code_status, {"user_code": "ABCD-1234", "device_auth_id": "dev-1", "interval": 3})
        if url.endswith("/deviceauth/token"):
            return self.polls.pop(0)
        return self.token


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def make_login(openai, home):
    clock = Clock()
    return ChatGptLogin(home, client_factory=openai, clock=clock), clock


class LoginTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name)
        os.chmod(self.home, 0o700)

    def tearDown(self):
        self.dir.cleanup()

    def test_sign_in_writes_a_private_auth_file_and_never_returns_tokens(self):
        ok = FakeResponse(200, {"authorization_code": "c", "code_verifier": "v"})
        openai = FakeOpenAI(polls=[FakeResponse(404), ok],
                            token=FakeResponse(200, {"access_token": "AT-secret", "refresh_token": "RT-secret"}))
        login, clock = make_login(openai, self.home)
        self.assertEqual(login.status(), {"state": "signed_out"})
        started = login.start()
        self.assertEqual((started["state"], started["userCode"]), ("pending", "ABCD-1234"))
        self.assertTrue(started["verificationUrl"].endswith("/codex/device"))
        clock.now += 3
        self.assertEqual(login.status()["state"], "pending")  # 404: not approved yet
        clock.now += 3
        result = login.status()
        self.assertEqual(result, {"state": "signed_in"})
        self.assertNotIn("secret", json.dumps(result))
        auth = self.home / "auth.json"
        self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
        tokens = json.loads(auth.read_text())["providers"]["openai-codex"]["tokens"]
        self.assertEqual(tokens, {"access_token": "AT-secret", "refresh_token": "RT-secret"})

    def test_polls_no_faster_than_the_interval(self):
        openai = FakeOpenAI(polls=[FakeResponse(403)] * 5)
        login, clock = make_login(openai, self.home)
        login.start()
        for _ in range(4):
            login.status()
        self.assertEqual(sum(c.endswith("/deviceauth/token") for c in openai.calls), 0)
        clock.now += 3
        login.status()
        login.status()
        self.assertEqual(sum(c.endswith("/deviceauth/token") for c in openai.calls), 1)

    def test_start_reuses_the_pending_code(self):
        openai = FakeOpenAI()
        login, _ = make_login(openai, self.home)
        login.start()
        login.start()
        self.assertEqual(sum(c.endswith("/usercode") for c in openai.calls), 1)

    def test_times_out_after_fifteen_minutes(self):
        login, clock = make_login(FakeOpenAI(), self.home)
        login.start()
        clock.now += 16 * 60
        self.assertEqual(login.status(), {"state": "failed", "code": "device_code_timeout"})

    def test_rate_limit_and_errors_are_reported_without_state(self):
        login, _ = make_login(FakeOpenAI(code_status=429), self.home)
        with self.assertRaises(LoginError) as error:
            login.start()
        self.assertEqual(error.exception.code, "rate_limited")
        self.assertEqual(login.status(), {"state": "signed_out"})

    def test_rejected_exchange_fails_without_writing_credentials(self):
        ok = FakeResponse(200, {"authorization_code": "c", "code_verifier": "v"})
        login, clock = make_login(FakeOpenAI(polls=[ok], token=FakeResponse(400)), self.home)
        login.start()
        clock.now += 3
        self.assertEqual(login.status(), {"state": "failed", "code": "login_failed"})
        self.assertFalse((self.home / "auth.json").exists())

    def test_logout_removes_the_credentials(self):
        (self.home / "auth.json").write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
            "access_token": "a", "refresh_token": "r"}}}}))
        os.chmod(self.home / "auth.json", 0o600)
        login, _ = make_login(FakeOpenAI(), self.home)
        self.assertEqual(login.status(), {"state": "signed_in"})
        login.logout()
        self.assertEqual(login.status(), {"state": "signed_out"})

    def test_world_readable_credentials_do_not_count_as_signed_in(self):
        (self.home / "auth.json").write_text("{}")
        os.chmod(self.home / "auth.json", 0o644)
        login, _ = make_login(FakeOpenAI(), self.home)
        self.assertEqual(login.status(), {"state": "signed_out"})


class RobustnessTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name)
        os.chmod(self.home, 0o700)

    def tearDown(self):
        self.dir.cleanup()

    def test_busy_openai_is_retried_instead_of_failing_the_login(self):
        ok = FakeResponse(200, {"authorization_code": "c", "code_verifier": "v"})
        openai = FakeOpenAI(polls=[FakeResponse(503), FakeResponse(429), ok],
                            token=FakeResponse(200, {"access_token": "a", "refresh_token": "r"}))
        login, clock = make_login(openai, self.home)
        login.start()
        for expected in ("pending", "pending", "signed_in"):
            clock.now += 3
            self.assertEqual(login.status()["state"], expected)

    def test_a_busy_token_endpoint_keeps_waiting_but_a_rate_limit_fails(self):
        ok = FakeResponse(200, {"authorization_code": "c", "code_verifier": "v"})
        login, clock = make_login(FakeOpenAI(polls=[ok], token=FakeResponse(503)), self.home)
        login.start()
        clock.now += 3
        self.assertEqual(login.status()["state"], "pending")
        login, clock = make_login(FakeOpenAI(polls=[ok], token=FakeResponse(429)), self.home)
        login.start()
        clock.now += 3
        self.assertEqual(login.status(), {"state": "failed", "code": "rate_limited"})

    def test_unreadable_replies_fail_cleanly(self):
        class Broken(FakeResponse):
            def json(self):
                raise ValueError("not json")

        class BrokenCode(FakeOpenAI):
            def post(self, url, **kwargs):
                if url.endswith("/usercode"):
                    return Broken(200)
                return super().post(url, **kwargs)

        login, _ = make_login(BrokenCode(), self.home)
        with self.assertRaises(LoginError) as error:
            login.start()
        self.assertEqual(error.exception.code, "login_failed")
        ok = FakeResponse(200, {"authorization_code": "c", "code_verifier": "v"})
        login, clock = make_login(FakeOpenAI(polls=[ok], token=Broken(200)), self.home)
        login.start()
        clock.now += 3
        # An unreadable token reply is treated as transient: keep waiting, write nothing.
        self.assertEqual(login.status()["state"], "pending")
        self.assertFalse((self.home / "auth.json").exists())

    def test_logout_during_a_poll_is_not_overwritten(self):
        ok = FakeResponse(200, {"authorization_code": "c", "code_verifier": "v"})
        login, clock = make_login(FakeOpenAI(polls=[ok], token=FakeResponse(
            200, {"access_token": "a", "refresh_token": "r"})), self.home)
        login.start()
        original = login._poll

        def poll_then_logout(job):
            outcome = original(job)
            login.logout()  # the admin cancels while OpenAI is being asked
            return outcome

        login._poll = poll_then_logout
        clock.now += 3
        self.assertEqual(login.status(), {"state": "signed_out"})
        self.assertFalse((self.home / "auth.json").exists())


class HttpTests(unittest.TestCase):
    KEY = "k" * 32

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        os.chmod(self.dir.name, 0o700)
        openai = FakeOpenAI()
        self.server = make_server("127.0.0.1", 0, self.KEY, object(), ChatGptLogin(self.dir.name, openai, Clock()))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.dir.cleanup()

    def call(self, method, path, key=None):
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        try:
            with urlopen(Request(self.base + path, method=method, headers=headers,
                                 data=b"" if method == "POST" else None)) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def test_auth_routes_require_the_bridge_key(self):
        for method, path in (("GET", "/v1/auth/status"), ("POST", "/v1/auth/start"), ("POST", "/v1/auth/logout")):
            with self.subTest(path=path):
                self.assertEqual(self.call(method, path)[0], 401)
                self.assertEqual(self.call(method, path, "wrong" * 8)[0], 401)

    def test_start_then_status_then_logout(self):
        status, body = self.call("POST", "/v1/auth/start", self.KEY)
        self.assertEqual((status, body["state"], body["userCode"]), (200, "pending", "ABCD-1234"))
        self.assertEqual(self.call("GET", "/v1/auth/status", self.KEY)[1]["state"], "pending")
        self.assertEqual(self.call("POST", "/v1/auth/logout", self.KEY), (200, {"state": "signed_out"}))
        self.assertEqual(self.call("GET", "/v1/auth/status", self.KEY)[1], {"state": "signed_out"})


if __name__ == "__main__":
    unittest.main()
