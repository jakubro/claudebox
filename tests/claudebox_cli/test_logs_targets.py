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


class TestRenderLine:
    """``_render_line`` parses a JSON log record and rewrites the timestamp to ISO8601, with pass-through for non-JSON."""

    def test_json_line_renders_iso_timestamp(self) -> None:
        import json

        from claudebox_cli.cmd_logs import _render_line

        record = {
            "timestamp": 1780166824.318,
            "level": "info",
            "logger": "claudebox.x",
            "event": "Boot completed",
        }
        result = _render_line(json.dumps(record))

        # Float epoch is replaced by ISO date+time; original float must NOT appear.
        assert "1780166824" not in result
        assert "2026" in result and ":" in result
        assert "Boot completed" in result

    def test_non_json_line_passthrough(self) -> None:
        from claudebox_cli.cmd_logs import _render_line

        line = "  some unstructured shell banner with no JSON"
        result = _render_line(line)
        assert result == line.rstrip("\n")

    def test_warning_level_emits_color_under_force_color(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """ConsoleRenderer tints the warning level token red/yellow under FORCE_COLOR."""

        import json
        import os

        monkeypatch.setenv("FORCE_COLOR", "1")
        os.environ.pop("NO_COLOR", None)

        # Reload the renderer module so the structlog ConsoleRenderer rebuilds
        # against the active color environment.
        import importlib

        import claudebox.core.log_rendering as lr

        importlib.reload(lr)

        record = {
            "timestamp": 1780166824.318,
            "level": "warning",
            "logger": "claudebox.x",
            "event": "soft warning",
        }
        out = lr.render_event(record)
        # ANSI escape sequence emitted by Rich/structlog console styling.
        assert "\x1b[" in out


class TestStreamEndMessage:
    """``_stream_end_message`` distinguishes clean EOF, HTTP errors, and connection errors."""

    def test_clean_eof_dim(self) -> None:
        import httpx

        from claudebox_cli.cmd_logs import _stream_end_message

        out = _stream_end_message({"id": "707098ca-xyz-abc"}, None)
        assert "[dim]" in out
        assert "707098ca" in out
        assert "stream ended" in out

    def test_http_status_error_includes_status_and_reason(self) -> None:
        import httpx

        from claudebox_cli.cmd_logs import _stream_end_message

        request = httpx.Request("GET", "https://localhost/api/logs")
        response = httpx.Response(500, request=request, text="SessionNotReady")
        exc = httpx.HTTPStatusError(
            "Server error '500 Internal Server Error'", request=request, response=response
        )

        out = _stream_end_message({"id": "7a7e25af-xyz"}, exc)
        assert "[red]" in out
        assert "7a7e25af" in out
        assert "HTTP 500" in out
        assert "SessionNotReady" in out

    def test_connect_error_includes_class_and_message(self) -> None:
        import httpx

        from claudebox_cli.cmd_logs import _stream_end_message

        exc = httpx.ConnectError("connection refused")
        out = _stream_end_message({"id": "fde3cad1-xyz"}, exc)
        assert "[red]" in out
        assert "fde3cad1" in out
        assert "ConnectError" in out
        assert "connection refused" in out

    def test_read_error_includes_class(self) -> None:
        import httpx

        from claudebox_cli.cmd_logs import _stream_end_message

        exc = httpx.ReadError("mid-stream drop")
        out = _stream_end_message({"id": "abcdef012345"}, exc)
        assert "ReadError" in out
        assert "mid-stream drop" in out

    def test_missing_id_renders_question_mark(self) -> None:
        from claudebox_cli.cmd_logs import _stream_end_message

        out = _stream_end_message({}, None)
        assert "container ?" in out
