"""Parser-level tests for ``claudebox containers`` action + target parsing."""

import pytest

from host_cli import app


parser = app.parser


class TestContainersAction:
    """Action parses to args.action; bare → action=None."""

    @pytest.mark.parametrize("action", ["list", "stop", "kill"])
    def test_each_action_recognized(self, action: str) -> None:
        # stop/kill require a target — pass a placeholder.
        argv = ["containers", action] + (["dummy"] if action in ("stop", "kill") else [])
        args = parser.parse_args(argv)
        assert args.action == action

    def test_bare_containers_action_is_none(self) -> None:
        args = parser.parse_args(["containers"])
        assert args.action is None

    def test_unknown_action_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["containers", "bogus"])
        assert exc.value.code == 2


class TestContainersTarget:
    """stop/kill accept an arbitrary target string; list takes none."""

    @pytest.mark.parametrize("action", ["stop", "kill"])
    def test_target_required(self, action: str) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["containers", action])
        assert exc.value.code == 2

    @pytest.mark.parametrize("action", ["stop", "kill"])
    @pytest.mark.parametrize("target", ["abc123456789", "abc1", "all"])
    def test_target_accepted(self, action: str, target: str) -> None:
        args = parser.parse_args(["containers", action, target])
        assert args.action == action
        assert args.target == target

    def test_list_does_not_take_target(self) -> None:
        # list parses cleanly with no target.
        args = parser.parse_args(["containers", "list"])
        assert args.action == "list"
        # Extra positional after list is rejected.
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["containers", "list", "extra"])
        assert exc.value.code == 2
