"""Tests for claudebox.constants - env-overridable accessors."""

from claudebox.constants import DAEMON_PORT, daemon_base_url


class TestDaemonBaseUrl:
    """Test CLAUDEBOX_DAEMON_URL env override of the daemon base URL."""

    def test_default_when_unset(self, monkeypatch):
        monkeypatch.delenv("CLAUDEBOX_DAEMON_URL", raising=False)
        assert daemon_base_url() == f"https://localhost:{DAEMON_PORT}"

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_DAEMON_URL", "http://127.0.0.1:55555")
        assert daemon_base_url() == "http://127.0.0.1:55555"

    def test_empty_env_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_DAEMON_URL", "")
        assert daemon_base_url() == f"https://localhost:{DAEMON_PORT}"
