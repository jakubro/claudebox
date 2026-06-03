"""Parser-level tests for ``claudebox logs`` target + flag parsing."""

import pytest

from host_cli import app


parser = app.parser


class TestLogsTarget:
    """``logs`` accepts {daemon, all} positional or defaults to ``daemon``."""

    def test_default_target_is_daemon(self) -> None:
        args = parser.parse_args(["logs"])
        assert args.target == "daemon"

    @pytest.mark.parametrize("target", ["daemon", "all"])
    def test_explicit_target(self, target: str) -> None:
        args = parser.parse_args(["logs", target])
        assert args.target == target

    def test_unknown_target_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["logs", "bogus"])
        assert exc.value.code == 2


class TestLogsTailFlag:
    """``--tail`` parses an integer with default 100."""

    def test_default_tail_is_100(self) -> None:
        args = parser.parse_args(["logs"])
        assert args.tail == 100

    def test_explicit_tail(self) -> None:
        args = parser.parse_args(["logs", "--tail", "50"])
        assert args.tail == 50

    def test_non_integer_tail_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["logs", "--tail", "abc"])
        assert exc.value.code == 2


class TestLogsNoFollowFlag:
    """``--no-follow`` is a boolean flag, default False."""

    def test_default_no_follow_false(self) -> None:
        args = parser.parse_args(["logs"])
        assert args.no_follow is False

    def test_no_follow_true(self) -> None:
        args = parser.parse_args(["logs", "--no-follow"])
        assert args.no_follow is True

    def test_combined_flags(self) -> None:
        args = parser.parse_args(["logs", "all", "--tail", "5", "--no-follow"])
        assert args.target == "all"
        assert args.tail == 5
        assert args.no_follow is True


class TestColorizeLogLine:
    """``colorize_log_line`` wraps level tokens in Rich tags."""

    def test_error_wrapped(self) -> None:
        from claudebox_cli.cmd_logs import colorize_log_line

        result = colorize_log_line("2026-05-14 ERROR something broke")
        assert "[red]ERROR[/red]" in result

    def test_warning_wrapped(self) -> None:
        from claudebox_cli.cmd_logs import colorize_log_line

        result = colorize_log_line("2026-05-14 WARNING heads up")
        assert "[yellow]WARNING[/yellow]" in result

    def test_info_passthrough(self) -> None:
        from claudebox_cli.cmd_logs import colorize_log_line

        line = "2026-05-14 INFO ok"
        # INFO maps to 'default' color → no tag wrapping (passthrough).
        result = colorize_log_line(line)
        assert result == line

    def test_debug_wrapped_dim(self) -> None:
        from claudebox_cli.cmd_logs import colorize_log_line

        result = colorize_log_line("2026-05-14 DEBUG noisy")
        assert "[dim]DEBUG[/dim]" in result
