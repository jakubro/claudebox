"""Sentinel tests for the hermetic CLI infrastructure.

Three checks: the wrapper rejects unsafe invocation, the fake daemon is reachable
from a CLI subprocess under loopback, and the fake bins record args correctly.
Behavior tests for individual CLI verbs live in the sibling test_*.py files.
"""

import subprocess
from pathlib import Path

import httpx
import pytest
from pytest_httpserver import HTTPServer


# pytest-socket allow-list opt-in must live in the test module — pytestmark in conftest.py
# does not propagate to test files. See conftest.py for the broader isolation contract.
pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


WRAPPER = Path(__file__).parent / "claudebox-test"


def test_wrapper_hard_fails_without_env() -> None:
    """Direct invocation without CLAUDEBOX_TEST_* env vars must exit 1 with a FATAL message."""

    result = subprocess.run(
        [str(WRAPPER)],
        capture_output=True,
        text=True,
        env={"PATH": "/usr/bin:/bin"},
        check=False,
        timeout=5,
    )
    assert result.returncode == 1
    assert "CLAUDEBOX_TEST_HOME" in result.stderr


def test_fake_daemon_reachable_under_isolation(fake_daemon: str, httpserver: HTTPServer) -> None:
    """pytest-httpserver binds 127.0.0.1; loopback must work under the sandbox layer."""

    httpserver.expect_request("/ping").respond_with_data("pong", status=200)
    response = httpx.get(f"{fake_daemon}/ping", timeout=5)
    assert response.status_code == 200
    assert response.text == "pong"


def test_fake_podman_records_args(fake_bins_dir: Path, record_dir: Path) -> None:
    """Fake podman appends args to records dir and returns canned output."""

    result = subprocess.run(
        [str(fake_bins_dir / "podman"), "image", "prune"],
        capture_output=True,
        text=True,
        env={"CLAUDEBOX_TEST_RECORD_DIR": str(record_dir), "PATH": "/usr/bin:/bin"},
        check=False,
        timeout=5,
    )
    assert result.returncode == 0
    assert "Total reclaimed space" in result.stdout
    log = (record_dir / "podman.log").read_text()
    assert "image prune" in log


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
