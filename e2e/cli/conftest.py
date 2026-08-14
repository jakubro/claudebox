"""Hermetic CLI test fixtures.

Three-layer isolation:
- Layer 1 - bwrap on host / container in-container - blocks network and filesystem at the kernel
  boundary (see ``lib/tests/conftest.py``).
- Layer 2 - the ``claudebox-test`` wrapper next to this file - hard-fails on missing isolation
  env vars and exports ``HOME`` / ``UV_OFFLINE`` / a PATH prefix before exec'ing
  ``lib/bin/claudebox_cli.sh``.
- Layer 3 - fakes on PATH and a pytest-httpserver-backed daemon on loopback - records every
  external invocation while letting the CLI exercise real code paths.

``run_claudebox`` composes all three: hermetic HOME, fake-bin PATH prefix, recording directory,
and ``CLAUDEBOX_DAEMON_URL`` pointing at the in-process fake daemon.
"""

import os
import subprocess
from collections.abc import Callable
from pathlib import Path

import pytest
from pytest_httpserver import HTTPServer


# argcomplete separates completion candidates on the fd-8 stream with a vertical tab.
ARGCOMPLETE_IFS = "\x0b"


# bwrap/the container bring loopback up automatically; the fake daemon binds 127.0.0.1.
# Each test module needs its own ``pytest.mark.allow_hosts(["127.0.0.1", "::1"])`` since the
# mark here does not propagate; both IPv4 and IPv6 are listed since localhost may resolve to
# either, depending on /etc/hosts ordering.


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
def complete(
    claudebox_bin: Path,
    hermetic_home: Path,
    fake_bins_dir: Path,
    record_dir: Path,
    fake_daemon: str,
) -> Callable[..., list[str]]:
    """Drive argcomplete's protocol for a COMP_LINE and return the offered candidates."""

    def _complete(comp_line: str, *, daemon_url: str | None = None) -> list[str]:
        env = {
            **os.environ,
            "CLAUDEBOX_TEST_HOME": str(hermetic_home),
            "CLAUDEBOX_TEST_PATH_PREFIX": str(fake_bins_dir),
            "CLAUDEBOX_TEST_RECORD_DIR": str(record_dir),
            "CLAUDEBOX_DAEMON_URL": daemon_url if daemon_url is not None else fake_daemon,
            "_ARGCOMPLETE": "1",
            "_ARGCOMPLETE_SHELL": "bash",
            "COMP_LINE": comp_line,
            "COMP_POINT": str(len(comp_line)),
            "COMP_TYPE": "9",
        }

        # argcomplete writes candidates to fd 8; route to stdout and mute the program's own
        # output to isolate completions.
        result = subprocess.run(
            ["bash", "-c", 'exec 8>&1 1>/dev/null 2>/dev/null; exec "$@"', "_", str(claudebox_bin)],
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
            check=False,
        )

        return [c for c in result.stdout.split(ARGCOMPLETE_IFS) if c]

    return _complete


@pytest.fixture
def run_claudebox(
    claudebox_bin: Path,
    hermetic_home: Path,
    fake_bins_dir: Path,
    record_dir: Path,
    fake_daemon: str,
) -> Callable[..., subprocess.CompletedProcess[str]]:
    """Invoke the CLI via the hermetic wrapper.

    Sets HOME, PATH prefix, CLAUDEBOX_DAEMON_URL, and the record dir; caller-supplied env
    merges last, letting tests override keys like FORCE_COLOR.
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
