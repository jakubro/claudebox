"""Tests for claudebox.agent_session.orchestration.projection - session summary accumulator."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from claudebox import read_json, write_json
from claudebox.agent_session.orchestration.projection import BUILTIN_COMMANDS, Projection
from claudebox.workspace import Workspace
from ._helpers import make_published_event as _make_event


# --- _categorize_commands ---


class TestCategorizeCommands:
    """Test slash command classification.

    _categorize_commands normally reads skill metadata from the runtime; name-only fallback still categorizes here.
    """

    @staticmethod
    def _projection(tmp_workspace, monkeypatch) -> Projection:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        return Projection(
            session_id="sess-categorize",
            workspace=Workspace(start_dir=tmp_workspace),
        )

    def test_builtin_command(self, tmp_workspace, monkeypatch):
        result = self._projection(tmp_workspace, monkeypatch)._categorize_commands(["help"])
        assert result["builtin"] == [{"name": "help"}]
        assert result["custom"] == []
        assert result["mcp"] == []

    def test_mcp_command(self, tmp_workspace, monkeypatch):
        result = self._projection(tmp_workspace, monkeypatch)._categorize_commands(
            ["mcp__slack__send"],
        )
        assert result["mcp"] == [{"name": "mcp__slack__send"}]

    def test_custom_command(self, tmp_workspace, monkeypatch):
        result = self._projection(tmp_workspace, monkeypatch)._categorize_commands(["my-tool"])
        assert result["custom"] == [{"name": "my-tool"}]

    def test_mixed_commands(self, tmp_workspace, monkeypatch):
        result = self._projection(tmp_workspace, monkeypatch)._categorize_commands(
            ["help", "mcp__jira__create", "deploy"],
        )
        assert result["builtin"] == [{"name": "help"}]
        assert result["mcp"] == [{"name": "mcp__jira__create"}]
        assert result["custom"] == [{"name": "deploy"}]

    def test_empty_list(self, tmp_workspace, monkeypatch):
        result = self._projection(tmp_workspace, monkeypatch)._categorize_commands([])
        assert result == {"custom": [], "mcp": [], "builtin": []}

    def test_all_builtin_commands_recognized(self, tmp_workspace, monkeypatch):
        result = self._projection(tmp_workspace, monkeypatch)._categorize_commands(
            list(BUILTIN_COMMANDS),
        )
        assert len(result["builtin"]) == len(BUILTIN_COMMANDS)
        assert result["custom"] == []
        assert result["mcp"] == []


# --- Projection.update ---


class TestProjectionUpdate:
    """Test session summary accumulation from events."""

    @staticmethod
    def _make_projection(tmp_workspace, monkeypatch) -> Projection:
        """Create a Projection with a temp workspace."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        return Projection("test-session", ws)

    def test_human_event_increments_turns(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=True, content="hello"))
        assert proj.value.num_turns == 1

    def test_non_human_event_no_turn_increment(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=False))
        assert proj.value.num_turns == 0

    def test_first_message_captured(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=True, content="first"))
        assert proj.value.first_message == "first"

    def test_last_message_updated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=True, content="first"))
        proj.update(_make_event(is_human=True, content="second"))
        assert proj.value.first_message == "first"
        assert proj.value.last_message == "second"

    def test_model_updated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(model="claude-sonnet-5"))
        assert proj.value.model == "claude-sonnet-5"

    def test_duration_accumulated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(duration_ms=100))
        proj.update(_make_event(duration_ms=200))
        assert proj.value.total_duration_ms == 300

    def test_context_tokens_updated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(context_tokens=5000))
        assert proj.value.last_context_tokens == 5000

    def test_permission_mode_updated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(permission_mode="plan"))
        assert proj.value.permission_mode == "plan"

    def test_todos_updated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        todos = [{"content": "fix bug", "status": "in_progress"}]
        proj.update(_make_event(tool_input={"todos": todos}))
        assert proj.value.todos == todos

    def test_commands_categorized(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(
            _make_event(message_data={"slash_commands": ["help", "mcp__jira__create", "deploy"]}),
        )
        assert proj.value.commands["builtin"] == [{"name": "help"}]  # ty: ignore[not-subscriptable]
        assert proj.value.commands["mcp"] == [{"name": "mcp__jira__create"}]  # ty: ignore[not-subscriptable]
        assert proj.value.commands["custom"] == [{"name": "deploy"}]  # ty: ignore[not-subscriptable]

    def test_none_fields_ignored(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        initial_cost = proj.value.total_cost_usd
        proj.update(_make_event(cost_usd=None))
        assert proj.value.total_cost_usd == initial_cost

    def test_null_accumulators_from_disk(self, tmp_workspace, monkeypatch):
        """Accumulator fields loaded as None from disk don't crash on +=."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        proj = Projection("null-acc-session", ws)
        proj.save()

        write_json(
            proj._path,
            {
                "session_id": "null-acc-session",
                "fork_point_cost_usd": 0.0,
                "num_turns": None,
                "total_cost_usd": None,
                "total_duration_ms": None,
            },
        )

        proj2 = Projection("null-acc-session", ws)

        proj2.update(_make_event(is_human=True, content="hello"))
        assert proj2.value.num_turns == 1

        proj2.update(_make_event(cost_usd=0.05))
        assert proj2.value.total_cost_usd == pytest.approx(0.05)

        proj2.update(_make_event(duration_ms=500))
        assert proj2.value.total_duration_ms == 500


def _result(cost: float):
    return _make_event(type="result", subtype="success", cost_usd=cost)


class TestCostCountsEachTurnOnce:
    """A Claude result's cost is the CLI's running total; LangGraph's is the turn's own."""

    @staticmethod
    def _workspace(tmp_workspace, monkeypatch) -> Workspace:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        return Workspace(start_dir=tmp_workspace)

    @pytest.mark.parametrize(
        ("running_totals", "spent"),
        [
            ([0.68, 4.18, 4.37], 4.37),
            ([1.00, 0.30], 1.30),
            ([1.00, 1.30], 1.30),
            ([0.68, 4.18, 4.37, 0.50, 0.90], 5.27),
        ],
    )
    def test_claude_cost_counts_each_turn_once(
        self,
        tmp_workspace,
        monkeypatch,
        running_totals,
        spent,
    ):
        proj = Projection("cost-session", self._workspace(tmp_workspace, monkeypatch))

        for total in running_totals:
            proj.update(_result(total))

        assert proj.value.total_cost_usd == pytest.approx(spent)

    @pytest.mark.parametrize(("first_after_restart", "spent"), [(0.30, 1.30), (1.30, 1.30)])
    def test_claude_cost_survives_a_container_restart(
        self,
        tmp_workspace,
        monkeypatch,
        first_after_restart,
        spent,
    ):
        ws = self._workspace(tmp_workspace, monkeypatch)
        before = Projection("cost-session", ws)
        before.update(_result(0.40))
        before.update(_result(1.00))
        before.save()

        after = Projection("cost-session", ws)
        after.update(_result(first_after_restart))

        assert after.value.total_cost_usd == pytest.approx(spent)

    def test_langgraph_cost_adds_each_turn(self, tmp_workspace, monkeypatch):
        ws = self._workspace(tmp_workspace, monkeypatch)
        record = {
            "session_id": "cost-session",
            "runtime": "LangGraph",
            "total_cost_usd": 0.0,
            "fork_point_cost_usd": 0.0,
        }
        write_json(ws.ensure_session("cost-session").path / "session.json", record)
        proj = Projection("cost-session", ws)

        proj.update(_result(0.01))
        proj.update(_result(0.02))

        assert proj.value.total_cost_usd == pytest.approx(0.03)

    def test_a_langgraph_runtime_adds_each_turn_whatever_the_record_says(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        ws = self._workspace(tmp_workspace, monkeypatch)
        record = {"session_id": "cost-session", "runtime": "Claude", "fork_point_cost_usd": 0.0}
        write_json(ws.ensure_session("cost-session").path / "session.json", record)
        langgraph = SimpleNamespace(runtime_name="LangGraph", get_skills=list)
        proj = Projection("cost-session", ws, runtime=langgraph)  # ty: ignore[invalid-argument-type]

        proj.update(_result(0.01))
        proj.update(_result(0.02))

        assert proj.value.total_cost_usd == pytest.approx(0.03)

    def test_a_record_without_a_baseline_takes_it_from_the_log(self, tmp_workspace, monkeypatch):
        ws = self._workspace(tmp_workspace, monkeypatch)
        record = {"session_id": "cost-session", "total_cost_usd": 1.00, "fork_point_cost_usd": 0.0}
        write_json(ws.ensure_session("cost-session").path / "session.json", record)
        proj = Projection("cost-session", ws)

        proj.seed_last_result_cost([_result(0.40), _result(1.00), _make_event(type="user")])
        proj.update(_result(1.30))

        assert proj.value.total_cost_usd == pytest.approx(1.30)

    def test_a_record_with_a_baseline_keeps_it(self, tmp_workspace, monkeypatch):
        ws = self._workspace(tmp_workspace, monkeypatch)
        proj = Projection("cost-session", ws)
        proj.update(_result(1.00))

        proj.seed_last_result_cost([_result(5.00)])
        proj.update(_result(1.30))

        assert proj.value.total_cost_usd == pytest.approx(1.30)


# --- Projection runtime/provider stamping ---


class TestProjectionRuntimeStamping:
    """Test runtime/provider stamped on a fresh summary, never overwritten on resume."""

    def test_fresh_session_stamps_runtime_and_provider(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        fake_runtime = SimpleNamespace(runtime_name="LangGraph")

        proj = Projection(
            "sess-1",
            ws,
            runtime=fake_runtime,  # ty: ignore[invalid-argument-type]
            provider="ollama",
        )

        assert proj.value.runtime == "LangGraph"
        assert proj.value.provider == "ollama"

    def test_no_runtime_leaves_fields_none(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        proj = Projection("sess-2", ws)

        assert proj.value.runtime is None
        assert proj.value.provider is None

    def test_resume_does_not_overwrite_persisted_runtime(self, tmp_workspace, monkeypatch):
        """Persisted runtime wins on resume; the mismatch is surfaced elsewhere, not fixed here."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        fake_langgraph = SimpleNamespace(runtime_name="LangGraph")

        proj = Projection(
            "sess-3",
            ws,
            runtime=fake_langgraph,  # ty: ignore[invalid-argument-type]
            provider="ollama",
        )
        proj.save()

        fake_claude = SimpleNamespace(runtime_name="Claude")
        proj2 = Projection(
            "sess-3",
            ws,
            runtime=fake_claude,  # ty: ignore[invalid-argument-type]
            provider=None,
        )

        assert proj2.value.runtime == "LangGraph"
        assert proj2.value.provider == "ollama"

    def test_a_record_holding_only_daemon_stamps_still_gets_runtime_and_provider(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        """The daemon stamps a new session before the container's first save; that is no session."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        path = ws.ensure_session("sess-4").path / "session.json"
        write_json(path, {"bundle": "research", "spawned_from_session_id": "sess-0"})

        proj = Projection(
            "sess-4",
            ws,
            runtime=SimpleNamespace(runtime_name="Claude"),  # ty: ignore[invalid-argument-type]
            provider=None,
        )
        proj.save()

        assert proj.loaded_from_disk is False
        on_disk = read_json(path)
        assert on_disk["runtime"] == "Claude"
        assert on_disk["bundle"] == "research"
        assert on_disk["spawned_from_session_id"] == "sess-0"

    def test_a_seeded_session_prompt_survives_the_first_save(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        path = ws.ensure_session("sess-5").path / "session.json"
        write_json(path, {"bundle": "research", "session_prompt": "Cite file:line."})

        proj = Projection(
            "sess-5",
            ws,
            runtime=SimpleNamespace(runtime_name="Claude"),  # ty: ignore[invalid-argument-type]
        )
        proj.save()

        assert proj.loaded_from_disk is False
        assert proj.value.session_prompt == "Cite file:line."
        assert read_json(path)["session_prompt"] == "Cite file:line."
        assert read_json(path)["runtime"] == "Claude"


# --- Projection.update: needs_user ---


class TestProjectionNeedsUser:
    """A session needs the user from a signal or a pending form until the user's next message."""

    @staticmethod
    def _projection(tmp_workspace, monkeypatch, session_id="needs-session") -> Projection:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        return Projection(session_id, Workspace(start_dir=tmp_workspace))

    @staticmethod
    def _tool(name, tool_input, **overrides):
        return _make_event(subtype="tool_use", tool_name=name, tool_input=tool_input, **overrides)

    @pytest.mark.parametrize("name", ["mcp__claudebox__needs_user", "needs_user"])
    def test_signal_sets_the_reason_under_either_runtime(self, tmp_workspace, monkeypatch, name):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool(name, {"reason": "Decide: where retry state lives"}))

        assert proj.value.needs_user == "Decide: where retry state lives"

    @pytest.mark.parametrize("name", ["mcp__claudebox__needs_user", "needs_user"])
    def test_signal_sets_its_replies_under_either_runtime(self, tmp_workspace, monkeypatch, name):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool(name, {"reason": "Approve: file it", "replies": ["Go", "Hold"]}))

        assert proj.value.needs_user_replies == ["Go", "Hold"]

    def test_replies_keep_five_first_lines_of_the_non_blank_entries(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)
        replies = ["  ", "Go\nnow", 7, "Hold", "Skip", "Later", "Never", "Ask", "Defer"]

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": replies}))

        assert proj.value.needs_user_replies == ["Go", "Hold", "Skip", "Later", "Never"]

    def test_a_repeated_reply_shows_once(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": ["Go", "Go\nnow"]}))

        assert proj.value.needs_user_replies == ["Go"]

    @pytest.mark.parametrize("replies", [None, [], ["  "], "Go"])
    def test_a_signal_without_usable_replies_stores_none(self, tmp_workspace, monkeypatch, replies):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": replies}))

        assert proj.value.needs_user == "Decide: A"
        assert proj.value.needs_user_replies is None

    def test_a_later_signal_replaces_the_replies(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": ["Go", "Hold"]}))
        proj.update(self._tool("needs_user", {"reason": "Decide: B", "replies": ["Ship it"]}))

        assert proj.value.needs_user_replies == ["Ship it"]

    def test_a_signal_without_replies_removes_earlier_ones(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": ["Go"]}))
        proj.update(self._tool("needs_user", {"reason": "Decide: B"}))

        assert proj.value.needs_user == "Decide: B"
        assert proj.value.needs_user_replies is None

    def test_a_form_removes_the_replies(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": ["Go"]}))
        proj.update(self._tool("AskUserQuestion", {"questions": [{"question": "Which?"}]}))

        assert proj.value.needs_user == "Which?"
        assert proj.value.needs_user_replies is None

    def test_the_users_next_message_clears_the_replies(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": ["Go"]}))
        proj.update(_make_event(subtype="text", is_human=True, content="Go"))

        assert proj.value.needs_user is None
        assert proj.value.needs_user_replies is None

    def test_replies_survive_a_save_and_reload(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        proj.update(self._tool("needs_user", {"reason": "Decide: A", "replies": ["Go", "Hold"]}))
        proj.save()

        reloaded = self._projection(tmp_workspace, monkeypatch)

        assert reloaded.value.needs_user_replies == ["Go", "Hold"]

    def test_only_the_first_line_of_a_reason_is_kept(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "\n  Blocked: no creds  \nmore detail"}))

        assert proj.value.needs_user == "Blocked: no creds"

    def test_blank_reason_still_signals(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "  "}))

        assert proj.value.needs_user == "Needs you"

    def test_later_signal_replaces_the_reason(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A"}))
        proj.update(self._tool("needs_user", {"reason": "Decide: B"}))

        assert proj.value.needs_user == "Decide: B"

    @pytest.mark.parametrize("name", ["AskUserQuestion", "ask_user_question"])
    def test_question_form_sets_its_text(self, tmp_workspace, monkeypatch, name):
        proj = self._projection(tmp_workspace, monkeypatch)
        questions = [{"header": "Mode", "question": "Which mode?"}, {"question": "Second?"}]

        proj.update(self._tool(name, {"questions": questions}))

        assert proj.value.needs_user == "Which mode?"

    def test_question_without_text_falls_back_to_header_then_generic(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("AskUserQuestion", {"questions": [{"header": "Mode"}]}))

        assert proj.value.needs_user == "Mode"

        proj.update(self._tool("AskUserQuestion", {"questions": [{"question": 3}]}))

        assert proj.value.needs_user == "Answer a question"

    @pytest.mark.parametrize("tool_input", [{}, {"questions": []}, {"questions": "Which?"}])
    def test_question_that_shows_no_form_sets_nothing(self, tmp_workspace, monkeypatch, tool_input):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("ask_user_question", tool_input))

        assert proj.value.needs_user is None

    def test_plan_approval_sets_its_reason(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("ExitPlanMode", {"plan": "1. Do it"}))

        assert proj.value.needs_user == "Approve the plan"

    @pytest.mark.parametrize("tool_input", [{}, {"plan": ""}, {"plan": None}])
    def test_plan_without_text_sets_nothing(self, tmp_workspace, monkeypatch, tool_input):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("ExitPlanMode", tool_input))

        assert proj.value.needs_user is None

    def test_user_message_clears_it(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        proj.update(self._tool("needs_user", {"reason": "Decide: A"}))

        proj.update(_make_event(type="user", is_human=True, content="go with A"))

        assert proj.value.needs_user is None

    def test_subagent_prompt_does_not_clear_it(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        proj.update(self._tool("needs_user", {"reason": "Decide: A"}))

        proj.update(
            _make_event(type="user", is_human=True, content="explore", parent_tool_use_id="t1"),
        )

        assert proj.value.needs_user == "Decide: A"

    def test_subagent_signal_does_not_set_it(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(self._tool("needs_user", {"reason": "Decide: A"}, parent_tool_use_id="t1"))
        proj.update(
            self._tool(
                "AskUserQuestion",
                {"questions": [{"question": "?"}]},
                parent_tool_use_id="t1",
            ),
        )

        assert proj.value.needs_user is None

    def test_plain_finish_changes_nothing(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        proj.update(_make_event(type="result", subtype="success"))
        proj.update(self._tool("Bash", {"command": "ls"}))

        assert proj.value.needs_user is None

    @pytest.mark.parametrize(
        "lineage",
        [{"spawned_from_session_id": "parent-1"}, {"is_side_thread": True}],
    )
    def test_spawned_session_or_side_thread_never_needs_the_user(
        self,
        tmp_workspace,
        monkeypatch,
        lineage,
    ):
        """Lineage lands on disk after the projection was built, as the daemon writes it."""

        proj = self._projection(tmp_workspace, monkeypatch)
        proj.save()
        write_json(proj._path, {**read_json(proj._path), **lineage})

        proj.update(self._tool("needs_user", {"reason": "Decide: A"}))
        proj.update(self._tool("AskUserQuestion", {"questions": [{"question": "Which?"}]}))

        assert proj.value.needs_user is None

    def test_survives_a_save_and_reload(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        proj.update(self._tool("needs_user", {"reason": "Decide: A"}))
        proj.save()

        reloaded = self._projection(tmp_workspace, monkeypatch)

        assert reloaded.loaded_from_disk
        assert reloaded.value.needs_user == "Decide: A"


# --- Projection.loaded_from_disk ---


def _human(content="go"):
    return _make_event(type="user", subtype="text", is_human=True, content=content)


def _assistant(**overrides):
    return _make_event(type="assistant", subtype="text", content="ok", **overrides)


def _finished():
    return _make_event(type="result", subtype="success")


def _failure():
    return _make_event(type="system", subtype="error", content="boom")


def _bash_use(tool_use_id, tool_input, **overrides):
    return _make_event(
        subtype="tool_use",
        content="Bash",
        tool_name="Bash",
        tool_use_id=tool_use_id,
        tool_input=tool_input,
        **overrides,
    )


def _bash_launch(tool_use_id, task_id, **overrides):
    return _make_event(
        type="user",
        subtype="tool_result",
        tool_use_id=tool_use_id,
        tool_use_result={
            "stdout": "",
            "stderr": "",
            "interrupted": False,
            "backgroundTaskId": task_id,
        },
        **overrides,
    )


def _agent_launch(tool_use_id, agent_id):
    return _make_event(
        type="user",
        subtype="tool_result",
        tool_use_id=tool_use_id,
        tool_use_result={"isAsync": True, "status": "async_launched", "agentId": agent_id},
    )


def _notice(task_id, status="completed"):
    return _make_event(
        type="system",
        subtype="task_notification",
        message_data={"task_id": task_id, "status": status},
    )


def _restart():
    return _make_event(type="system", subtype="container_restarted")


class TestProjectionActivity:
    """A session works from the reader's message to its result, then waits while background work runs.

    The background cases mirror `appendBackgroundLaunches` and `selectRunningBackgroundWork` in the
    browser's utils/eventProcessing.test.js, so the two copies of the rule change together.
    """

    @staticmethod
    def _projection(tmp_workspace, monkeypatch) -> Projection:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))

        return Projection("activity-session", Workspace(start_dir=tmp_workspace))

    @staticmethod
    def _fold(proj, events):
        for event in events:
            proj.update(event)

        return proj.value.activity

    def test_works_from_the_message_to_its_result(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        assert self._fold(proj, [_human()]) == "working"
        assert self._fold(proj, [_assistant()]) == "working"
        assert self._fold(proj, [_finished()]) is None

    def test_an_answer_alone_starts_work(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        assert self._fold(proj, [_assistant()]) == "working"

    def test_a_reported_failure_ends_work(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        assert self._fold(proj, [_human(), _failure()]) is None

    def test_a_subagents_own_events_change_nothing(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        self._fold(proj, [_human(), _finished()])

        assert self._fold(proj, [_assistant(parent_tool_use_id="task1")]) is None
        self._fold(proj, [_human()])
        assert (
            self._fold(
                proj,
                [_make_event(type="result", subtype="success", parent_tool_use_id="task1")],
            )
            == "working"
        )

    def test_waits_while_a_background_command_runs_and_works_again_on_its_notice(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)
        launch = [_human(), _bash_use("tu1", {"command": "sleep 90", "run_in_background": True})]

        assert self._fold(proj, [*launch, _bash_launch("tu1", "b1"), _finished()]) == "waiting"
        assert self._fold(proj, [_notice("b1")]) == "working"
        assert self._fold(proj, [_finished()]) is None

    def test_waits_while_a_background_subagent_runs(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        assert self._fold(proj, [_human(), _agent_launch("tu9", "a1"), _finished()]) == "waiting"

    def test_counts_a_command_moved_to_the_background_after_its_time_limit(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)
        timed_out = _bash_launch("tu1", "b7")
        timed_out.tool_use_result = {
            "stdout": "",
            "backgroundTaskId": "b7",
            "timedOutAfterMs": 600000,
        }

        assert (
            self._fold(
                proj,
                [_human(), _bash_use("tu1", {"command": "just check"}), timed_out, _finished()],
            )
            == "waiting"
        )

    def test_ignores_a_foreground_command_and_work_launched_inside_a_subagent(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)
        foreground = _make_event(
            type="user",
            subtype="tool_result",
            tool_use_id="tu1",
            tool_use_result={"stdout": "a"},
        )
        nested = [
            _bash_use(
                "tu2",
                {"command": "sleep 9", "run_in_background": True},
                parent_tool_use_id="task1",
            ),
            _bash_launch("tu2", "b2", parent_tool_use_id="task1"),
        ]

        events = [_human(), _bash_use("tu1", {"command": "ls"}), foreground, *nested, _finished()]

        assert self._fold(proj, events) is None

    def test_a_background_id_without_a_bash_call_counts_nothing(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        assert self._fold(proj, [_human(), _bash_launch("tu-unknown", "b1"), _finished()]) is None

    @pytest.mark.parametrize("status", ["completed", "failed", "killed"])
    def test_a_notice_of_any_status_ends_a_launch(self, tmp_workspace, monkeypatch, status):
        proj = self._projection(tmp_workspace, monkeypatch)
        events = [
            _human(),
            _bash_use("tu1", {"command": "sleep 1"}),
            _bash_launch("tu1", "b1"),
            _notice("b1", status),
        ]

        assert self._fold(proj, [*events, _finished()]) is None

    def test_a_notice_arriving_before_its_launch_result_ends_it(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        events = [
            _human(),
            _bash_use("tu1", {"command": "true"}),
            _notice("b1"),
            _bash_launch("tu1", "b1"),
        ]

        assert self._fold(proj, [*events, _finished()]) is None

    def test_a_container_restart_ends_work_and_forgets_launches_before_it(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)
        before = [_human(), _bash_use("tu1", {"command": "sleep 99"}), _bash_launch("tu1", "b1")]

        assert self._fold(proj, [*before, _restart()]) is None
        assert self._fold(proj, [_human(), _finished()]) is None

    def test_reports_only_a_change(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)

        assert proj.update(_human()) is True
        assert proj.update(_assistant()) is False
        assert proj.update(_finished()) is True

    def test_a_fresh_projection_takes_open_launches_since_the_last_restart(
        self,
        tmp_workspace,
        monkeypatch,
    ):
        proj = self._projection(tmp_workspace, monkeypatch)
        history = [
            _bash_use("tu1", {"command": "sleep 99"}),
            _bash_launch("tu1", "b1"),
            _restart(),
            _bash_use("tu2", {"command": "sleep 99"}),
            _bash_launch("tu2", "b2"),
            _agent_launch("tu3", "a3"),
            _notice("a3"),
        ]

        proj.seed_background_work(history)

        assert self._fold(proj, [_human(), _finished()]) == "waiting"
        assert self._fold(proj, [_notice("b2"), _finished()]) is None

    def test_survives_a_save_and_reload(self, tmp_workspace, monkeypatch):
        proj = self._projection(tmp_workspace, monkeypatch)
        self._fold(proj, [_human()])
        proj.save()

        assert self._projection(tmp_workspace, monkeypatch).value.activity == "working"


class TestProjectionLoadedFromDisk:
    """Test loaded_from_disk flag tracks whether session.json existed."""

    def test_fresh_projection_not_loaded(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        proj = Projection("new-session", ws)
        assert proj.loaded_from_disk is False

    def test_existing_projection_loaded(self, tmp_workspace, monkeypatch):
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)
        proj = Projection("existing-session", ws)
        proj.update(_make_event(is_human=True, content="hello"))
        proj.save()

        proj2 = Projection("existing-session", ws)
        assert proj2.loaded_from_disk is True


# --- Projection._refresh_daemon_fields ---


class TestRefreshDaemonFields:
    """Test that value property picks up externally-written daemon fields."""

    @staticmethod
    def _make_projection(tmp_workspace, monkeypatch) -> Projection:
        """Create a Projection with a temp workspace."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        return Projection("test-session", ws)

    def test_name_updated_from_disk(self, tmp_workspace, monkeypatch):
        """Verify value picks up name written externally to session.json."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        assert proj.value.name is None

        # Simulate daemon writing a name to session.json
        proj.save()
        data = {"session_id": "test-session", "name": "renamed"}
        write_json(proj._path, data)

        assert proj.value.name == "renamed"

    def test_name_cleared_from_disk(self, tmp_workspace, monkeypatch):
        """Verify clearing name on disk is reflected in value."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj._value.name = "old-name"
        proj.save()

        # Daemon clears name
        data = {"session_id": "test-session", "name": None}
        write_json(proj._path, data)

        assert proj.value.name is None

    def test_parent_session_id_updated_from_disk(self, tmp_workspace, monkeypatch):
        """Verify value picks up parent_session_id written externally."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        assert proj.value.parent_session_id is None

        proj.save()
        data = {"session_id": "test-session", "parent_session_id": "parent-abc"}
        write_json(proj._path, data)

        assert proj.value.parent_session_id == "parent-abc"

    def test_spawned_from_session_id_updated_from_disk(self, tmp_workspace, monkeypatch):
        """A spawn socket child's lineage, written directly before session.json exists, survives
        this projection's first save the same way parent_session_id already does."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        assert proj.value.spawned_from_session_id is None

        proj.save()
        data = {"session_id": "test-session", "spawned_from_session_id": "spawner-abc"}
        write_json(proj._path, data)

        assert proj.value.spawned_from_session_id == "spawner-abc"

    def test_save_keeps_a_name_written_while_the_session_streams(self, tmp_workspace, monkeypatch):
        """A save after a daemon rename persists the rename, not the pre-rename snapshot."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.save()

        write_json(proj._path, {"session_id": "test-session", "name": "renamed"})
        proj.update(_make_event(cost_usd=0.01))
        proj.save()

        assert read_json(proj._path)["name"] == "renamed"

    def test_save_keeps_every_daemon_owned_field(self, tmp_workspace, monkeypatch):
        """All four daemon-owned fields survive a save, not just name."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.save()

        written = {
            "session_id": "test-session",
            "name": "renamed",
            "parent_session_id": "parent-abc",
            "is_side_thread": True,
            "spawned_from_session_id": "spawner-abc",
        }
        write_json(proj._path, written)
        proj.update(_make_event(cost_usd=0.01))
        proj.save()

        on_disk = read_json(proj._path)
        assert {field: on_disk[field] for field in written} == written

    def test_update_fields_keeps_a_name_written_meanwhile(self, tmp_workspace, monkeypatch):
        """The container's own update_fields path preserves a rename it never saw."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.save()

        write_json(proj._path, {"session_id": "test-session", "name": "renamed"})
        proj.update_fields(session_prompt="set via the container route")

        on_disk = read_json(proj._path)
        assert on_disk["name"] == "renamed"
        assert on_disk["session_prompt"] == "set via the container route"

    def test_save_keeps_a_name_cleared_on_disk(self, tmp_workspace, monkeypatch):
        """A name the daemon cleared stays cleared - the in-memory value must not resurrect it."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj._value.name = "old-name"
        proj.save()

        write_json(proj._path, {"session_id": "test-session", "name": None})
        proj.update(_make_event(cost_usd=0.01))
        proj.save()

        assert read_json(proj._path)["name"] is None

    def test_projection_fields_not_overwritten(self, tmp_workspace, monkeypatch):
        """Verify projection-tracked fields (cost, turns) remain authoritative from memory."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(cost_usd=0.05))
        proj.update(_make_event(is_human=True, content="hello"))
        proj.save()

        # Daemon writes stale cost (e.g. from initial session.json)
        data = {"session_id": "test-session", "total_cost_usd": 0.0, "num_turns": 0}
        write_json(proj._path, data)

        # Memory values should be authoritative for non-daemon fields
        assert proj.value.total_cost_usd == pytest.approx(0.05)
        assert proj.value.num_turns == 1


# --- Projection.update_fields ---


class TestProjectionUpdateFields:
    """Test update_fields for direct field writes."""

    @staticmethod
    def _make_projection(tmp_workspace, monkeypatch) -> Projection:
        """Create a Projection with a temp workspace."""

        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        return Projection("test-session", ws)

    def test_sets_known_field(self, tmp_workspace, monkeypatch):
        """update_fields sets known attributes on the summary."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update_fields(name="renamed-session")
        assert proj.value.name == "renamed-session"

    def test_ignores_unknown_field(self, tmp_workspace, monkeypatch):
        """update_fields ignores fields not on SessionSummary."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        # Should not raise
        proj.update_fields(nonexistent_field="value")

    def test_persists_to_disk(self, tmp_workspace, monkeypatch):
        """update_fields saves immediately to disk."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update_fields(name="persisted")

        ws = Workspace(start_dir=tmp_workspace)
        proj2 = Projection("test-session", ws)
        assert proj2.value.name == "persisted"


# --- Projection.update effort_level ---


class TestProjectionEffortLevel:
    """Test effort_level_changed event processing."""

    @staticmethod
    def _make_projection(tmp_workspace, monkeypatch) -> Projection:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        return Projection("test-session", ws)

    def test_effort_level_updated(self, tmp_workspace, monkeypatch):
        """effort_level_changed event sets effort_level on summary."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(subtype="effort_level_changed", content="high"))
        assert proj.value.effort_level == "high"


# --- Projection.schedule_save / flush ---


class TestProjectionSaveLifecycle:
    """Test debounced save and flush."""

    @staticmethod
    def _make_projection(tmp_workspace, monkeypatch) -> Projection:
        monkeypatch.setenv("CLAUDEBOX_PWD", str(tmp_workspace))
        ws = Workspace(start_dir=tmp_workspace)

        return Projection("test-session", ws)

    @pytest.mark.anyio
    async def test_schedule_save_writes_after_debounce(self, tmp_workspace, monkeypatch):
        """schedule_save writes to disk after debounce interval."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=True, content="hello"))
        proj.schedule_save()
        ws = Workspace(start_dir=tmp_workspace)

        async with asyncio.timeout(10):
            while Projection("test-session", ws).value.num_turns != 1:
                await asyncio.sleep(0.05)

        assert Projection("test-session", ws).value.num_turns == 1

    @pytest.mark.anyio
    async def test_flush_forces_pending_save(self, tmp_workspace, monkeypatch):
        """flush() writes immediately even if debounce hasn't elapsed."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=True, content="hello"))
        proj.schedule_save()
        await proj.flush()

        ws = Workspace(start_dir=tmp_workspace)
        proj2 = Projection("test-session", ws)
        assert proj2.value.num_turns == 1

    @pytest.mark.anyio
    async def test_flush_noop_when_clean(self, tmp_workspace, monkeypatch):
        """flush() is a no-op when there are no pending changes."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        await proj.flush()  # should not raise

    @pytest.mark.anyio
    async def test_save_cancels_pending_timer(self, tmp_workspace, monkeypatch):
        """Synchronous save() cancels any pending debounced save."""

        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(is_human=True, content="hello"))
        proj.schedule_save()

        assert proj._save_timer is not None
        proj.save()
        assert proj._save_timer is None
        assert proj._dirty is False
