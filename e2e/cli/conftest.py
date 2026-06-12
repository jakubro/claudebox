"""Hermetic CLI test fixtures.

Three-layer isolation:
- Layer 1 — bwrap on host / container in-container — blocks network and filesystem at the kernel
  boundary (see ``lib/tests/conftest.py``).
- Layer 2 — the ``claudebox-test`` wrapper next to this file — hard-fails on missing isolation env
  vars and exports ``HOME`` / ``UV_OFFLINE`` / a PATH prefix before exec'ing
  ``lib/bin/claudebox_cli.sh``.
- Layer 3 — fakes on PATH and a pytest-httpserver-backed daemon on loopback — let the CLI exercise
  real code paths while recording every external invocation.

The ``run_claudebox`` fixture composes all three: every subprocess invocation
gets a hermetic HOME, a fake-bin PATH prefix, a recording directory, and the
``CLAUDEBOX_DAEMON_URL`` pointing at the in-process fake daemon.
"""

import os
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer


# bwrap and the container both bring loopback up automatically; the fake daemon binds 127.0.0.1.
# pytest-socket allow-list opt-in must live in each test module via
# ``pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])`` — the mark in conftest.py
# does not propagate to test files. Both IPv4 and IPv6 loopback are listed because
# ``localhost`` may resolve to either depending on system /etc/hosts ordering.


@pytest.fixture
def hermetic_home(tmp_path: Path) -> Path:
    """Per-test fake HOME under tmp_path; ~/.claudebox/ writes go here."""

    home = tmp_path / ".home"
    home.mkdir()

    return home


@pytest.fixture
def record_dir(tmp_path: Path) -> Path:
    """Per-test directory where fake bins log invocations."""

    d = tmp_path / "records"
    d.mkdir()

    return d


@pytest.fixture
def fake_bins_dir() -> Path:
    """Path to the test-private fake-bin directory (committed to repo)."""

    return Path(__file__).parent / "fake_bins"


@pytest.fixture
def fake_daemon(httpserver: HTTPServer) -> str:
    """pytest-httpserver bound to loopback; returns base URL for CLAUDEBOX_DAEMON_URL."""

    return httpserver.url_for("").rstrip("/")


@pytest.fixture
def claudebox_bin() -> Path:
    """Path to the hermetic test wrapper."""

    bin_ = Path(__file__).parent / "claudebox-test"
    assert bin_.is_file() and os.access(bin_, os.X_OK), f"missing or non-executable: {bin_}"

    return bin_


@pytest.fixture
def run_claudebox(
    claudebox_bin: Path,
    hermetic_home: Path,
    fake_bins_dir: Path,
    record_dir: Path,
    fake_daemon: str,
) -> Callable[..., subprocess.CompletedProcess[str]]:
    """Invoke the CLI via the hermetic wrapper.

    Sets HOME, PATH prefix, CLAUDEBOX_DAEMON_URL, and the record dir. Caller-supplied
    env merges last (lets tests override specific keys, e.g. FORCE_COLOR).
    """

    def _run(
        args: list[str],
        *,
        cwd: Path | None = None,
        env: dict[str, str] | None = None,
        timeout: float = 30,
    ) -> subprocess.CompletedProcess[str]:
        merged_env = {
            **os.environ,
            "CLAUDEBOX_TEST_HOME": str(hermetic_home),
            "CLAUDEBOX_TEST_PATH_PREFIX": str(fake_bins_dir),
            "CLAUDEBOX_TEST_RECORD_DIR": str(record_dir),
            "CLAUDEBOX_DAEMON_URL": fake_daemon,
            **(env or {}),
        }

        return subprocess.run(
            [str(claudebox_bin), *args],
            capture_output=True,
            text=True,
            env=merged_env,
            cwd=str(cwd) if cwd else None,
            timeout=timeout,
            check=False,
        )

    return _run
