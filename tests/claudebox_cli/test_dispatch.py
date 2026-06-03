"""Verify the verb-mode parser dispatches each verb to the expected handler.

The parser is module-level state in ``host_cli``; tests exercise it directly via
``parser.parse_args`` rather than spawning subprocesses. The host_cli ``cli()``
guard prevents dispatch on import.
"""

import argparse

import pytest

from claudebox_cli import (
    cmd_build,
    cmd_containers,
    cmd_daemon,
    cmd_doctor,
    cmd_logs,
    cmd_prune,
    cmd_run,
    cmd_shell,
    cmd_status,
    cmd_update,
    cmd_version,
    cmd_workspaces,
)
from host_cli import app


parser = app.parser


# (verb, expected handler).
_VERB_HANDLERS = [
    ("run", cmd_run.handle),
    ("build", cmd_build.handle),
    ("update", cmd_update.handle),
    ("shell", cmd_shell.handle),
    ("prune", cmd_prune.handle),
    ("logs", cmd_logs.handle),
    ("status", cmd_status.handle),
    ("doctor", cmd_doctor.handle),
    ("version", cmd_version.handle),
    ("daemon", cmd_daemon.handle),
    ("containers", cmd_containers.handle),
    ("workspaces", cmd_workspaces.handle),
]


class TestVerbDispatch:
    """Each verb's subparser sets ``handler`` to the matching cmd_X.handle."""

    @pytest.mark.parametrize(("verb", "expected_handler"), _VERB_HANDLERS)
    def test_verb_dispatches_to_handler(self, verb: str, expected_handler) -> None:
        args = parser.parse_args([verb])
        assert args.handler is expected_handler

    def test_all_twelve_verbs_registered(self) -> None:
        subparsers_action = next(
            a for a in parser._actions if isinstance(a, argparse._SubParsersAction)
        )
        assert set(subparsers_action.choices) == {verb for verb, _ in _VERB_HANDLERS}


class TestVerboseFlag:
    """``-v/--verbose`` is accepted before AND after the verb."""

    def test_verbose_before_verb(self) -> None:
        args = parser.parse_args(["-v", "build"])
        assert args.verbose is True

    def test_verbose_after_verb(self) -> None:
        args = parser.parse_args(["build", "-v"])
        assert args.verbose is True

    def test_verbose_long_form_after_verb(self) -> None:
        args = parser.parse_args(["build", "--verbose"])
        assert args.verbose is True

    def test_default_verbose_false(self) -> None:
        args = parser.parse_args(["build"])
        assert args.verbose is False


class TestRunAgentArgs:
    """``run`` captures trailing agent args via argparse REMAINDER."""

    def test_no_agent_args(self) -> None:
        args = parser.parse_args(["run"])
        assert args.agent_args == []

    def test_agent_args_after_double_dash(self) -> None:
        args = parser.parse_args(["run", "--", "--resume"])
        # REMAINDER preserves the leading `--`; cmd_run.handle strips it.
        assert args.agent_args == ["--", "--resume"]

    def test_agent_args_complex(self) -> None:
        args = parser.parse_args(["run", "--", "-p", "echo smoke"])
        assert args.agent_args == ["--", "-p", "echo smoke"]


class TestBuildLayer:
    """``build --layer`` rejects unknown values and accepts {all, agent}."""

    def test_default_layer_none(self) -> None:
        args = parser.parse_args(["build"])
        assert args.layer is None

    def test_layer_all(self) -> None:
        args = parser.parse_args(["build", "--layer", "all"])
        assert args.layer == "all"

    def test_layer_agent(self) -> None:
        args = parser.parse_args(["build", "--layer", "agent"])
        assert args.layer == "agent"

    def test_layer_invalid_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["build", "--layer", "foo"])
        assert exc.value.code == 2


class TestDaemonActions:
    """``daemon`` accepts start/stop/restart/status sub-actions; bare → action=None."""

    @pytest.mark.parametrize("action", ["start", "stop", "restart", "status"])
    def test_action_parses(self, action: str) -> None:
        args = parser.parse_args(["daemon", action])
        assert args.action == action
        assert args.handler is cmd_daemon.handle

    def test_bare_daemon_action_is_none(self) -> None:
        args = parser.parse_args(["daemon"])
        assert args.action is None
        assert args.handler is cmd_daemon.handle

    def test_unknown_action_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["daemon", "bogus"])
        assert exc.value.code == 2
