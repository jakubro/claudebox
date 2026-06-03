"""Tests for claudebox.agent_session.orchestration.projection — session summary accumulator."""

import asyncio

import pytest

from claudebox import write_json
from claudebox.agent_session.orchestration.projection import BUILTIN_COMMANDS, Projection
from claudebox.workspace import Workspace
from ._helpers import make_published_event as _make_event


# --- _categorize_commands ---


class TestCategorizeCommands:
    """Test slash command classification."""

    @pytest.fixture(autouse=True)
    def _isolate_home(self, tmp_path, monkeypatch):
        """Redirect Path.home() so ClaudeRuntime.get_skills() can't reach host ~/.claude."""

        monkeypatch.setattr("pathlib.Path.home", staticmethod(lambda: tmp_path))

    def test_builtin_command(self):
        result = Projection._categorize_commands(["help"])
        assert result["builtin"] == [{"name": "help"}]
        assert result["custom"] == []
        assert result["mcp"] == []

    def test_mcp_command(self):
        result = Projection._categorize_commands(["mcp__slack__send"])
        assert result["mcp"] == [{"name": "mcp__slack__send"}]

    def test_custom_command(self):
        result = Projection._categorize_commands(["my-tool"])
        assert result["custom"] == [{"name": "my-tool"}]

    def test_mixed_commands(self):
        result = Projection._categorize_commands(["help", "mcp__jira__create", "deploy"])
        assert result["builtin"] == [{"name": "help"}]
        assert result["mcp"] == [{"name": "mcp__jira__create"}]
        assert result["custom"] == [{"name": "deploy"}]

    def test_empty_list(self):
        result = Projection._categorize_commands([])
        assert result == {"custom": [], "mcp": [], "builtin": []}

    def test_all_builtin_commands_recognized(self):
        result = Projection._categorize_commands(list(BUILTIN_COMMANDS))
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
        proj.update(_make_event(model="claude-sonnet-4-6"))
        assert proj.value.model == "claude-sonnet-4-6"

    def test_cost_accumulated(self, tmp_workspace, monkeypatch):
        proj = self._make_projection(tmp_workspace, monkeypatch)
        proj.update(_make_event(cost_usd=0.01))
        proj.update(_make_event(cost_usd=0.02))
        assert proj.value.total_cost_usd == pytest.approx(0.03)

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
            _make_event(message_data={"slash_commands": ["help", "mcp__jira__create", "deploy"]})
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

        # Create and save a projection, then reload with null accumulators
        proj = Projection("null-acc-session", ws)
        proj.save()

        # Write session.json with null accumulator fields
        write_json(
            proj._path,
            {
                "session_id": "null-acc-session",
                "num_turns": None,
                "total_cost_usd": None,
                "total_duration_ms": None,
            },
        )

        proj2 = Projection("null-acc-session", ws)

        # All three accumulators should handle None gracefully
        proj2.update(_make_event(is_human=True, content="hello"))
        assert proj2.value.num_turns == 1

        proj2.update(_make_event(cost_usd=0.05))
        assert proj2.value.total_cost_usd == pytest.approx(0.05)

        proj2.update(_make_event(duration_ms=500))
        assert proj2.value.total_duration_ms == 500


# --- Projection.loaded_from_disk ---


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

        # Reload from disk
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

        # Wait for debounce + async save
        await asyncio.sleep(1.0)

        ws = Workspace(start_dir=tmp_workspace)
        proj2 = Projection("test-session", ws)
        assert proj2.value.num_turns == 1

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
