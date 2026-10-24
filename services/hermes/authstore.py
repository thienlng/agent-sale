"""The single owner of ``<HERMES_HOME>/auth.json``: one inter-process lock plus atomic read/write.

Sign-in completion (``login.py``), logout and the runtime's token refresh (``runtime.py``) all
read-modify-write the same file, possibly from different threads or processes. Every one of them
goes through this module and holds ``lock()`` around the read-modify-write, so a logout or a new
sign-in is never undone by a refresh that started earlier. The lock is never held across network
I/O: callers read under the lock, talk to OpenAI outside it, then re-lock, compare and write.
"""

import fcntl
import json
import os
import tempfile
from contextlib import contextmanager
from pathlib import Path

TOKEN_KEYS = ("access_token", "refresh_token")


class AuthStore:
    def __init__(self, home):
        self.home = Path(home)
        self.path = self.home / "auth.json"
        self._lock_path = self.home / ".auth.lock"

    @contextmanager
    def lock(self):
        """Exclusive advisory lock (flock). Not re-entrant: do not nest."""
        descriptor = os.open(self._lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            os.fchmod(descriptor, 0o600)
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            os.close(descriptor)  # closing releases the flock

    def read(self):
        """Parsed auth state, or None if missing, a symlink, group/world accessible or malformed."""
        try:
            if self.path.is_symlink() or self.path.stat().st_mode & 0o077:
                return None
            state = json.loads(self.path.read_text(encoding="utf-8-sig"))
            tokens = state["providers"]["openai-codex"]["tokens"]
            if not all(isinstance(tokens.get(k), str) and tokens[k].strip() for k in TOKEN_KEYS):
                return None
            return state
        except (OSError, ValueError, TypeError, KeyError):
            return None

    @staticmethod
    def tokens(state):
        return state["providers"]["openai-codex"]["tokens"]

    def write(self, state):
        """Atomically replace auth.json (temp file is mode 600). Call with the lock held."""
        descriptor, name = tempfile.mkstemp(prefix="auth-", dir=self.home)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as output:
                json.dump(state, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(name, self.path)
        finally:
            if os.path.exists(name):
                os.unlink(name)

    def delete(self):
        """Remove auth.json. Call with the lock held."""
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass
