"""Verify bare, unknown-verb, and legacy flag-mode invocations exit 2.

Bare ``claudebox`` binds a root handler that returns 2 through normal dispatch; unknown verbs and legacy flags
hard-error via argparse's own path instead - no translation, no deprecation warnings.
"""

import pytest

from host_cli import app


parser = app.parser


class TestUnknownVerb:
    """Bare invocations and unknown verbs fail with exit 2."""

    def test_bare_claudebox_prints_help_and_returns_2(
        self,
        capsys: pytest.CaptureFixture[str],
    ) -> None:
        # Bare invocation doesn't error at parse time - the root handler prints help and returns 2 via dispatch.
        args = parser.parse_args([])
        assert args.handler(args) == 2
        out = capsys.readouterr().out
        assert "Run AI coding agents in a containerized dev environment." in out
        assert "<command>" in out

    def test_unknown_verb_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["foo"])

        assert exc.value.code == 2

    def test_unknown_verb_error_includes_choices(self, capsys: pytest.CaptureFixture[str]) -> None:
        with pytest.raises(SystemExit):
            parser.parse_args(["foo"])

        captured = capsys.readouterr()
        assert "invalid choice" in captured.err
        assert "run" in captured.err
        assert "build" in captured.err


class TestLegacyFlagsRejected:
    """Old flag-mode invocations hard-error via argparse."""

    @pytest.mark.parametrize("legacy_flag", ["-b", "-r", "-u", "--cleanup", "--no-run"])
    def test_legacy_flag_exits_2(self, legacy_flag: str) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args([legacy_flag])

        assert exc.value.code == 2

    def test_bash_positional_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["bash"])

        assert exc.value.code == 2

    def test_arbitrary_command_passthrough_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["python", "script.py"])

        assert exc.value.code == 2
