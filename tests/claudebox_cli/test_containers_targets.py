"""Parser-level tests for ``claudebox containers`` action + target parsing."""

from __future__ import annotations

import pytest
from rich.console import Console

from claudebox_cli import cmd_containers
from host_cli import app


parser = app.parser


class TestContainersAction:
    """Action parses to args.action; bare -> action=None."""

    @pytest.mark.parametrize("action", ["list", "stop", "kill"])
    def test_each_action_recognized(self, action: str) -> None:
        # stop/kill require a target - pass a placeholder.
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
        args = parser.parse_args(["containers", "list"])
        assert args.action == "list"

        with pytest.raises(SystemExit) as exc:
            parser.parse_args(["containers", "list", "extra"])

        assert exc.value.code == 2


class TestSessionColumns:
    """`containers list` names each container's session, its name and, while running, its state."""

    @pytest.fixture
    def table(self, monkeypatch):
        recorder = Console(record=True, width=250, no_color=True)
        monkeypatch.setattr(cmd_containers, "console", recorder)

        def _render(*containers: dict) -> list[str]:
            cmd_containers._render_list(list(containers))

            return recorder.export_text().splitlines()

        return _render

    @staticmethod
    def _container(status: str, session: dict | None, session_id: str = "6d3c97d7-aaaa") -> dict:
        return {
            "id": "c1aaaaaaaaaa1111",
            "workspace_id": "ws-a",
            "status": status,
            "session_id": session_id,
            "labels": {"kind": "session"},
            "session": session,
        }

    def test_the_header_orders_the_columns(self, table):
        header = next(line for line in table() if "WORKSPACE" in line)

        assert [cell.strip() for cell in header.split("┃")[1:-1]] == [
            "ID",
            "WORKSPACE",
            "SESSION",
            "NAME",
            "STATE",
            "SESSION STATE",
            "KIND",
            "AGE",
        ]

    def test_a_running_session_that_needs_you(self, table):
        row = table(
            self._container("running", {"name": "Fix the login flow", "needs_user": "Decide: x"}),
        )

        assert "6d3c97d7" in row[3] and "Fix the login flow" in row[3] and "needs you" in row[3]

    def test_an_automatic_name_shows_when_none_was_given(self, table):
        row = table(self._container("running", {"auto_name": "Tidy the release notes"}))

        assert "Tidy the release notes" in row[3] and "idle" in row[3]

    def test_a_container_not_running_shows_no_session_state(self, table):
        row = table(
            self._container("stopped", {"name": "Old spike", "needs_user": "Decide: stale"}),
        )

        assert "6d3c97d7" in row[3] and "Old spike" in row[3]
        assert "needs you" not in row[3] and "idle" not in row[3]

    def test_no_session_or_an_unloaded_listing_leaves_the_columns_empty(self, table):
        row = table(self._container("running", None))

        assert "6d3c97d7" not in row[3] and "idle" not in row[3]
        assert "c1aaaaaaaaaa" in row[3]

    def test_a_long_name_is_cut_with_an_ellipsis(self, table):
        row = table(self._container("running", {"name": "word " * 30}))

        assert "…" in row[3]

    @pytest.mark.parametrize("name", ["Tidy [wip] notes", "Close [/x] tag", "Fix [bold]x[/bold]"])
    def test_a_name_shows_as_typed(self, table, name):
        row = table(self._container("running", {"name": name}))

        assert name in row[3]

    def test_a_narrow_terminal_cuts_the_name_before_any_id(self, monkeypatch):
        recorder = Console(record=True, width=80, no_color=True)
        monkeypatch.setattr(cmd_containers, "console", recorder)
        container = self._container("running", {"name": "word " * 30})

        cmd_containers._render_list([container])
        row = recorder.export_text().splitlines()[3]

        assert container["id"][:12] in row
        assert container["session_id"][:8] in row


class TestSessionState:
    """The same cases as the app's dot rule (utils/sessionRow.test.js), so neither moves alone."""

    @pytest.mark.parametrize(
        ("session", "expected"),
        [
            ({"activity": "working", "needs_user": "Decide: x"}, "working"),
            ({"activity": "waiting", "needs_user": "Decide: x"}, "needs you"),
            ({"activity": "waiting"}, "waiting"),
            ({}, "idle"),
        ],
    )
    def test_the_state_follows_the_apps_ranking(self, session, expected):
        assert cmd_containers._session_state(session) == expected

    @pytest.mark.parametrize(
        ("session", "colour"),
        [
            ({"activity": "working"}, "\x1b[38;2;168;85;247m"),
            ({"activity": "waiting"}, "\x1b[2;38;2;168;85;247m"),
            ({"needs_user": "Decide: x"}, "\x1b[38;2;194;65;12m"),
            ({}, "\x1b[38;2;34;197;94m"),
        ],
    )
    def test_each_state_wears_its_dot_colour(self, monkeypatch, session, colour):
        recorder = Console(record=True, width=250, color_system="truecolor", force_terminal=True)
        monkeypatch.setattr(cmd_containers, "console", recorder)
        container = {"id": "c1", "status": "running", "session_id": "s1", "session": session}

        cmd_containers._render_list([container])

        assert colour in recorder.export_text(styles=True)
