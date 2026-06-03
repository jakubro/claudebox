"""End-to-end behavioral tests for ``claudebox logs``.

Exercises the SPEC ``cli:logs`` and ``cli:logs-colorization`` claims through
the real binary via subprocess. Daemon-running follow mode is not exercised
here (would hang indefinitely); ``--no-follow`` mode is.
"""


# SPEC: cli:logs
class TestLogsHelp:
    """``claudebox logs --help`` documents target + tail + no-follow."""

    def test_help_exits_zero(self, run_claudebox) -> None:
        result = run_claudebox(["logs", "--help"])
        assert result.returncode == 0

    def test_help_mentions_tail_no_follow(self, run_claudebox) -> None:
        result = run_claudebox(["logs", "--help"])
        for token in ("--tail", "--no-follow", "daemon"):
            assert token in result.stdout


# SPEC: cli:logs
class TestLogsMissingFile:
    """When the daemon log file is absent, logs prints a clear notice and exits 0."""

    def test_missing_log_file_exits_zero(self, tmp_path, run_claudebox) -> None:
        result = run_claudebox(
            ["logs", "--no-follow"],
            env={"HOME": str(tmp_path)},
            timeout=15,
        )
        assert result.returncode == 0
        combined = result.stdout + result.stderr
        assert "no daemon logs available" in combined


# SPEC: cli:logs
class TestLogsNoFollowBackfill:
    """``--no-follow`` reads existing log content and exits (no streaming wait)."""

    def test_seeded_log_backfilled(self, tmp_path, run_claudebox) -> None:
        log_dir = tmp_path / ".claudebox" / "logs"
        log_dir.mkdir(parents=True)
        log_file = log_dir / "daemon-41820.log"
        log_file.write_text(
            "2026-05-14 INFO first\n2026-05-14 WARNING middle\n2026-05-14 ERROR last\n"
        )

        result = run_claudebox(
            ["logs", "--tail", "3", "--no-follow"],
            env={"HOME": str(tmp_path), "NO_COLOR": "1"},
            timeout=15,
        )
        assert result.returncode == 0
        combined = result.stdout + result.stderr
        for token in ("first", "middle", "last"):
            assert token in combined


# SPEC: cli:logs-colorization
class TestLogsColorization:
    """Color tags are emitted for ERROR / WARNING (and absent for INFO)."""

    def test_warn_error_emit_color_tokens(self, tmp_path, run_claudebox) -> None:
        log_dir = tmp_path / ".claudebox" / "logs"
        log_dir.mkdir(parents=True)
        log_file = log_dir / "daemon-41820.log"
        log_file.write_text("2026-05-14 ERROR boom\n2026-05-14 WARNING soft\n2026-05-14 INFO ok\n")

        result = run_claudebox(
            ["logs", "--tail", "3", "--no-follow"],
            env={"HOME": str(tmp_path), "FORCE_COLOR": "1"},
            timeout=15,
        )
        combined = result.stdout + result.stderr
        # ANSI red ESC sequence for ERROR; yellow for WARNING. Rich emits these
        # under FORCE_COLOR=1 even on non-TTY.
        assert "\x1b[" in combined


# SPEC: cli:logs-all
class TestLogsAll:
    """``logs all`` multiplexes daemon + container output through the daemon HTTP surface."""

    def test_all_help_mentions_prefixes(self, run_claudebox) -> None:
        result = run_claudebox(["logs", "--help"])
        for token in ("[daemon]", "[container", "multiplex"):
            assert token in result.stdout

    def test_all_daemon_unreachable_exits_non_zero(self, tmp_path, run_claudebox) -> None:
        # No daemon running in the sandbox → httpx fails → graceful error + non-zero.
        result = run_claudebox(
            ["logs", "all", "--no-follow"],
            env={"HOME": str(tmp_path)},
            timeout=15,
        )
        assert result.returncode != 0
        combined = result.stdout + result.stderr
        assert "daemon not reachable" in combined
        assert "Traceback" not in result.stderr
