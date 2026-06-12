"""End-to-end behavioral tests for ``claudebox logs``.

Real-binary surfaces: missing-file path, seeded-backfill rendering, Rich
colorization with FORCE_COLOR, and ``logs all`` daemon-unreachable error.
"""

import json
from pathlib import Path

import pytest


pytestmark = pytest.mark.allow_hosts(["127.0.0.1", "::1"])


_DEAD_DAEMON_URL = "http://127.0.0.1:1"


def _seed_log(home: Path, records: list[dict]) -> None:
    """Write a daemon-port log file under the hermetic home."""

    log_dir = home / ".claudebox" / "logs"
    log_dir.mkdir(parents=True)
    log_file = log_dir / "daemon-41820.log"
    log_file.write_text("\n".join(json.dumps(r) for r in records) + "\n")


# SPEC: cli:logs
class TestLogsMissingFile:
    """Absent daemon log → clear notice + exit 0."""

    def test_missing_log_file_exits_zero(self, run_claudebox, hermetic_home) -> None:
        result = run_claudebox(["logs", "--no-follow"], timeout=15)
        assert result.returncode == 0
        combined = result.stdout + result.stderr
        assert "no daemon logs available" in combined


# SPEC: cli:logs
class TestLogsNoFollowBackfill:
    """``--no-follow`` reads existing log content and exits."""

    def test_seeded_log_backfilled(self, run_claudebox, hermetic_home) -> None:
        _seed_log(
            hermetic_home,
            [
                {"timestamp": 1747222800.0, "level": "info", "logger": "x", "event": "first"},
                {"timestamp": 1747222801.0, "level": "warning", "logger": "x", "event": "middle"},
                {"timestamp": 1747222802.0, "level": "error", "logger": "x", "event": "last"},
            ],
        )
        result = run_claudebox(
            ["logs", "--tail", "3", "--no-follow"],
            env={"NO_COLOR": "1"},
            timeout=15,
        )
        assert result.returncode == 0
        combined = result.stdout + result.stderr

        for token in ("first", "middle", "last"):
            assert token in combined


# SPEC: cli:logs-colorization
# SPEC: cli:logs:rendering
class TestLogsColorization:
    """warning/error rows emit ANSI escapes under FORCE_COLOR=1."""

    def test_warn_error_emit_color_tokens(self, run_claudebox, hermetic_home) -> None:
        _seed_log(
            hermetic_home,
            [
                {"timestamp": 1747222800.0, "level": "error", "logger": "x", "event": "boom"},
                {"timestamp": 1747222801.0, "level": "warning", "logger": "x", "event": "soft"},
                {"timestamp": 1747222802.0, "level": "info", "logger": "x", "event": "ok"},
            ],
        )
        result = run_claudebox(
            ["logs", "--tail", "3", "--no-follow"],
            env={"FORCE_COLOR": "1"},
            timeout=15,
        )
        combined = result.stdout + result.stderr
        assert "\x1b[" in combined
        assert "2025" in combined
        assert "1747222800" not in combined


# SPEC: cli:logs-all
# SPEC: cli:logs:multiplex
# SPEC: cli:logs:eof-cause
class TestLogsAll:
    """``logs all`` against an unreachable daemon: clean error + non-zero exit."""

    def test_all_daemon_unreachable_exits_non_zero(self, run_claudebox) -> None:
        result = run_claudebox(
            ["logs", "all", "--no-follow"],
            env={"CLAUDEBOX_DAEMON_URL": _DEAD_DAEMON_URL},
            timeout=15,
        )
        assert result.returncode != 0
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr
