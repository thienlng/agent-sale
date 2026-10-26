import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from authstore import AuthStore
from login import ChatGptLogin
from runtime import HermesRuntime, RuntimeUnavailable
from test_bridge import FakeAgent, payload


def write_auth(home, access, refresh):
    auth = Path(home) / "auth.json"
    auth.write_text(json.dumps({"providers": {"openai-codex": {"tokens": {
        "access_token": access, "refresh_token": refresh}}}}))
    auth.chmod(0o600)
    return auth


class RefreshRaceTests(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.home = Path(self.dir.name) / "private"
        self.env = patch.dict(os.environ, {}, clear=True)
        self.env.start()

    def tearDown(self):
        self.env.stop()
        self.dir.cleanup()

    def runtime(self, during_refresh=None):
        def refresh(access, refresh_token):
            if during_refresh:
                during_refresh()
            return {"access_token": "new-access", "refresh_token": "new-refresh"}

        return HermesRuntime(self.home, "openai-codex", FakeAgent,
                             token_refresher=refresh, expiry_check=lambda _token: True)

    def test_normal_refresh_still_persists(self):
        runtime = self.runtime()
        auth = write_auth(self.home, "old-access", "old-refresh")
        runtime.generate(payload())
        tokens = json.loads(auth.read_text())["providers"]["openai-codex"]["tokens"]
        self.assertEqual(tokens, {"access_token": "new-access", "refresh_token": "new-refresh"})
        self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
        self.assertEqual(FakeAgent.instances[-1].kwargs["api_key"], "new-access")

    def test_logout_during_a_refresh_stays_logged_out(self):
        login = ChatGptLogin(self.home)
        runtime = self.runtime(during_refresh=login.logout)
        auth = write_auth(self.home, "old-access", "old-refresh")
        with self.assertRaises(RuntimeUnavailable) as error:
            runtime.generate(payload())
        self.assertEqual(error.exception.code, "MODEL_AUTH_REQUIRED")
        self.assertFalse(auth.exists())

    def test_a_new_sign_in_during_a_refresh_is_not_overwritten(self):
        login = ChatGptLogin(self.home)
        runtime = self.runtime(during_refresh=lambda: login._save("signin-access", "signin-refresh"))
        auth = write_auth(self.home, "old-access", "old-refresh")
        with self.assertRaises(RuntimeUnavailable) as error:
            runtime.generate(payload())
        self.assertEqual(error.exception.code, "MODEL_AUTH_REQUIRED")
        tokens = json.loads(auth.read_text())["providers"]["openai-codex"]["tokens"]
        self.assertEqual(tokens["refresh_token"], "signin-refresh")

    def test_the_lock_is_not_held_during_the_network_refresh(self):
        runtime = self.runtime(during_refresh=lambda: self.assertTrue(
            self._can_lock_quickly(runtime.store)))
        write_auth(self.home, "old-access", "old-refresh")
        runtime.generate(payload())

    def _can_lock_quickly(self, store):
        acquired = []

        def attempt():
            with store.lock():
                acquired.append(True)

        thread = threading.Thread(target=attempt, daemon=True)
        thread.start()
        thread.join(2)
        return bool(acquired)


class AuthStoreTests(unittest.TestCase):
    def test_lock_file_is_private_and_excludes_other_holders(self):
        with tempfile.TemporaryDirectory() as directory:
            os.chmod(directory, 0o700)
            store = AuthStore(directory)
            order = []

            def other():
                with store.lock():
                    order.append("other")

            with store.lock():
                thread = threading.Thread(target=other, daemon=True)
                thread.start()
                time.sleep(0.2)
                order.append("holder")
            thread.join(2)
            self.assertEqual(order, ["holder", "other"])
            self.assertEqual((Path(directory) / ".auth.lock").stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
