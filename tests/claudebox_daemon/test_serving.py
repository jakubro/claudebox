"""Tests for claudebox_daemon.serving - port calculation, host binding, subprocess lifecycle."""

import os
import subprocess
import time
from pathlib import Path
from unittest.mock import patch

from claudebox.constants import DAEMON_DEV_PORT, DAEMON_PORT
from claudebox_daemon.serving import (
    _backend_port,
    _frontend_port,
    _resolve_port,
    _startup_banner,
    _stop_subprocess,
    backend_server,
)


class TestStartupBanner:
    """Startup banner renders install info as readable text, not a raw dict."""

    def test_banner_has_no_raw_dict_or_posixpath(self):
        info = {
            "version": "(unknown)",
            "branch": "v51",
            "commit": "76a76a9",
            "path": Path("/home/jakub/dev/share/lib/claudebox"),
            "python": "3.12.11",
        }

        with patch("claudebox_daemon.serving.get_install_info", return_value=info):
            banner = _startup_banner(DAEMON_PORT)

        assert "PosixPath" not in banner
        assert "{'" not in banner
        assert "v51 (76a76a9)" in banner
        assert "/home/jakub/dev/share/lib/claudebox" in banner


class TestBackendPort:
    """Port resolution for the backend (API) server."""

    def test_production_returns_port_plus_one(self):
        """In production mode the backend sits behind Caddy at port + 1."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            assert _backend_port(DAEMON_PORT) == DAEMON_PORT + 1

    def test_production_custom_port_gets_plus_one(self):
        """A non-default port also gets +1 in production (behind Caddy)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            assert _backend_port(9999) == 10000

    def test_dev_default_port_shifts_to_dev_range(self):
        """In dev mode the default production port auto-shifts to dev range + 1."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _backend_port(DAEMON_PORT) == DAEMON_DEV_PORT + 1

    def test_dev_custom_port_gets_plus_one(self):
        """A non-default port in dev mode gets +1 (backend sits behind frontend)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _backend_port(5000) == 5001

    def test_dev_dev_port_gets_plus_one(self):
        """Passing the dev port explicitly still applies the +1 offset."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _backend_port(DAEMON_DEV_PORT) == DAEMON_DEV_PORT + 1


class TestFrontendPort:
    """Port resolution for the Vite dev frontend server."""

    def test_production_returns_port_unchanged(self):
        """In production mode the requested port is used as-is."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            assert _frontend_port(DAEMON_PORT) == DAEMON_PORT

    def test_production_arbitrary_port_unchanged(self):
        """Any value passes through without modification in production."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            assert _frontend_port(7777) == 7777

    def test_dev_default_port_shifts_to_dev_range(self):
        """In dev mode the default production port auto-shifts to the dev range."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _frontend_port(DAEMON_PORT) == DAEMON_DEV_PORT

    def test_dev_custom_port_unchanged(self):
        """A non-default port in dev mode passes through without shift."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _frontend_port(5000) == 5000


class TestResolvePort:
    """Shared port resolution logic."""

    def test_dev_default_shifts(self):
        """Default port shifts to dev range in dev mode."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _resolve_port(DAEMON_PORT) == DAEMON_DEV_PORT

    def test_dev_custom_unchanged(self):
        """Non-default port passes through in dev mode."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=True):
            assert _resolve_port(9999) == 9999

    def test_prod_unchanged(self):
        """All ports pass through in production mode."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            assert _resolve_port(DAEMON_PORT) == DAEMON_PORT


class TestPortEdgeCases:
    """Test edge-case port values."""

    def test_zero_port(self):
        """Zero port is passed through (OS picks ephemeral port)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            result = _resolve_port(0)
            assert result == 0

    def test_negative_port(self):
        """Negative port is passed through (caller or OS should reject)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            result = _resolve_port(-1)
            assert isinstance(result, int)

    def test_overflow_port(self):
        """Port > 65535 is passed through (caller or OS should reject)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            result = _resolve_port(70000)
            assert result == 70000

    def test_zero_port_backend(self):
        """Zero port in backend mode gets +1 (behind Caddy)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            result = _backend_port(0)
            assert result == 1

    def test_negative_port_frontend(self):
        """Negative port in frontend mode."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            result = _frontend_port(-1)
            assert isinstance(result, int)

    def test_overflow_port_backend(self):
        """Port > 65535 in backend mode gets +1 (behind Caddy)."""

        with patch("claudebox_daemon.serving.is_dev_mode", return_value=False):
            result = _backend_port(70000)
            assert result == 70001


class TestBackendServerHostBinding:
    """The uvicorn backend binds loopback - Caddy is the only externally-bound listener."""

    def test_binds_loopback(self):
        info = {
            "version": "(unknown)",
            "branch": "v1",
            "commit": "abc",
            "path": Path("/x"),
            "python": "3.12",
        }

        with (
            patch("claudebox_daemon.serving.is_dev_mode", return_value=False),
            patch("claudebox_daemon.serving.https_proxy"),
            patch("claudebox_daemon.serving.get_install_info", return_value=info),
            patch("claudebox_daemon.serving.http_serve") as mock_http_serve,
        ):
            backend_server(lambda: None, port=DAEMON_PORT)

        assert mock_http_serve.call_args.kwargs["host"] == "127.0.0.1"


class TestStopSubprocessProcessGroup:
    """_stop_subprocess must reach a grandchild the immediate process doesn't forward signals to."""

    def test_kills_grandchild_the_immediate_process_does_not_forward_to(self, tmp_path):
        """Like npm: a shell doesn't forward SIGTERM to a backgrounded child, so it outlives
        its signaled parent unless the whole process group is signaled."""

        pid_file = tmp_path / "grandchild.pid"
        proc = subprocess.Popen(
            ["sh", "-c", f"sleep 30 & echo $! > {pid_file}; wait"],
            start_new_session=True,
        )

        for _ in range(50):
            if pid_file.exists():
                break

            time.sleep(0.1)

        grandchild_pid = int(pid_file.read_text().strip())

        _stop_subprocess(proc)

        assert _pid_gone(grandchild_pid)


def _pid_gone(pid: int, timeout: float = 3.0) -> bool:
    """Poll until a process id no longer exists, or the timeout elapses."""

    deadline = time.monotonic() + timeout

    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True

        time.sleep(0.05)

    return False
