"""Tests for claudebox.env — runtime environment checks."""

from claudebox.env import is_dev_mode, set_dev_mode


class TestIsDevMode:
    """Test CLAUDEBOX_DEV environment variable checking."""

    def test_returns_true_when_set(self, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_DEV", "1")
        assert is_dev_mode() is True

    def test_returns_false_when_zero(self, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_DEV", "0")
        assert is_dev_mode() is False

    def test_returns_false_when_unset(self, monkeypatch):
        monkeypatch.delenv("CLAUDEBOX_DEV", raising=False)
        assert is_dev_mode() is False

    def test_returns_false_for_other_values(self, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_DEV", "true")
        assert is_dev_mode() is False


class TestSetDevMode:
    """Test CLAUDEBOX_DEV environment variable setting."""

    def test_enable(self, monkeypatch):
        monkeypatch.delenv("CLAUDEBOX_DEV", raising=False)
        set_dev_mode(True)
        assert is_dev_mode() is True

    def test_disable(self, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_DEV", "1")
        set_dev_mode(False)
        assert is_dev_mode() is False
