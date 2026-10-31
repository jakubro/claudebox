"""End-to-end tests for ``bin/claudebox_daemon.sh``: a stop takes as long as the daemon needs, at most a grace.

The launcher runs a stand-in daemon through the real ``uv``, as under systemd, and gets SIGTERM alone.
"""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest


WRAPPER = Path(__file__).parent.parent.parent / "bin" / "claudebox_daemon.sh"

pytestmark = pytest.mark.skipif(
    not (shutil.which("uv") and shutil.which("pgrep")),
    reason="needs uv and pgrep on PATH",
)

UV_SHIM = """#!/bin/bash
# `uv run --project DIR SCRIPT ARGS` -> real uv running the stand-in instead of SCRIPT.
shift 4
exec "$REAL_UV" run --no-project --offline --python "$STANDIN_PY" "$STANDIN" "$@"
"""

STANDIN = """
import os, signal, subprocess, sys, time
mode = os.environ["MODE"]
def leave(signum, frame):
    if mode == "slow":
        time.sleep(1.0)
        open(os.environ["MARKER"], "w").close()
    sys.exit(128 + signum)
if mode in ("fast", "slow"):
    signal.signal(signal.SIGTERM, leave)
elif mode == "stubborn":
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    subprocess.Popen([sys.executable, "-c",
        "import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(600)"])
elif mode == "crash":
    print("ready", flush=True)
    time.sleep(0.3)
    sys.exit(3)
print("ready", flush=True)
while True:
    time.sleep(0.1)
"""


def _descendants(pid: int) -> list[int]:
    pgrep = ["pgrep", "-P", str(pid)]
    out = subprocess.run(pgrep, capture_output=True, text=True, check=False).stdout.split()

    return [p for c in out for p in (int(c), *_descendants(int(c)))]


def _alive(pid: int) -> bool:
    try:
        return (
            Path(f"/proc/{pid}/stat").read_text(encoding="utf-8").rsplit(")", 1)[1].split()[0]
            != "Z"
        )
    except FileNotFoundError:
        return False


def _stop(tmp_path: Path, mode: str) -> tuple[int, float, list[int]]:
    """Start the launcher on stand-in `mode`, TERM it unless it crashes; return exit, seconds, survivors."""

    shim = tmp_path / "uv"
    shim.write_text(UV_SHIM)
    shim.chmod(0o755)
    (tmp_path / "daemon.py").write_text(STANDIN)
    env = {
        **os.environ,
        "PATH": f"{tmp_path}:{os.environ['PATH']}",
        "REAL_UV": shutil.which("uv") or "uv",
        "STANDIN": str(tmp_path / "daemon.py"),
        "STANDIN_PY": sys.executable,
        "MODE": mode,
        "MARKER": str(tmp_path / "handled"),
    }
    launcher = subprocess.Popen(["bash", str(WRAPPER)], env=env, stdout=subprocess.PIPE, text=True)

    assert launcher.stdout is not None

    while not launcher.stdout.readline().startswith("ready"):
        pass

    time.sleep(0.3)
    tree = _descendants(launcher.pid)
    start = time.monotonic()

    if mode != "crash":
        launcher.send_signal(signal.SIGTERM)

    status = launcher.wait(timeout=20)
    took = time.monotonic() - start
    time.sleep(0.3)
    survivors = [pid for pid in tree if _alive(pid)]

    for pid in survivors:
        os.kill(pid, signal.SIGKILL)

    return status, took, survivors


# SPEC: cli:daemon-stop-prompt
def test_stop_returns_once_the_daemon_exits(tmp_path):
    status, took, survivors = _stop(tmp_path, "fast")

    assert (status, survivors) == (0, [])
    assert took < 1.5


# SPEC: cli:daemon-stop-prompt
def test_slow_shutdown_is_not_cut_short(tmp_path):
    status, took, _ = _stop(tmp_path, "slow")

    assert status == 0
    assert 0.9 <= took < 2.5
    assert (tmp_path / "handled").exists()


# SPEC: cli:daemon-stop-prompt
def test_ignored_stop_is_forced_after_the_grace(tmp_path):
    status, took, survivors = _stop(tmp_path, "stubborn")

    assert (status, survivors) == (0, [])
    assert 4.5 <= took < 6.5


def test_crash_status_propagates(tmp_path):
    status, _, _ = _stop(tmp_path, "crash")

    assert status == 3
