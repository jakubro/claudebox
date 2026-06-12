"""Parser-level tests for ``claudebox workspaces`` action + arg parsing."""

import pytest

from host_cli import app


parser = app.parser


class TestWorkspacesAction:
    """Action choices: list / register / deregister. Bare -> action=None."""

    @pytest.mark.parametrize(
        ("action", "extra"),
        [
            ("list", []),
            ("register", []),
            ("register", ["/some/path"]),
            ("deregister", ["foo"]),
        ],
    )
    def test_each_action_recognized(self, action: str, extra: list[str]) -> None:
        args = parser.parse_args(["workspaces", action, *extra])
        assert args.action == action

    def test_bare_action_is_none(self) -> None:
        args = parser.parse_args(["workspaces"])
        assert args.action is None

    def test_unknown_action_exits_2(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["workspaces", "bogus"])

        assert exc.value.code == 2


class TestWorkspacesRegisterArg:
    """register accepts an optional path argument (defaults to None -> cwd in handler)."""

    def test_register_with_no_path(self) -> None:
        args = parser.parse_args(["workspaces", "register"])
        assert args.action == "register"
        assert args.path is None

    def test_register_with_path(self) -> None:
        args = parser.parse_args(["workspaces", "register", "/some/path"])
        assert args.action == "register"
        assert args.path == "/some/path"


class TestWorkspacesDeregisterArg:
    """deregister requires a single id positional."""

    def test_deregister_requires_id(self) -> None:
        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["workspaces", "deregister"])

        assert exc.value.code == 2

    def test_deregister_with_id(self) -> None:
        args = parser.parse_args(["workspaces", "deregister", "foo"])
        assert args.action == "deregister"
        assert args.id == "foo"
