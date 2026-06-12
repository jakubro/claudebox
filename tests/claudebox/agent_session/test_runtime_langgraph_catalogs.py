"""LangGraphRuntime catalog methods - models via Ollama, context-window, defaults."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import (
    MODEL_CONTEXT_WINDOW,
    LangGraphRuntime,
)


def _config(
    tmp_path: Path, *, model: str | None = "ollama:llama3.2:3b", ollama="http://127.0.0.1:11434"
):
    # Tests pass models in the explicit `provider:model_id` form. The
    # runtime parser rejects bare model ids (no colon) so workspace TOML
    # mistakes fail loudly at session start; Ollama model ids themselves
    # contain colons (`llama3.2:3b`) so the only valid form is the explicit
    # `ollama:llama3.2:3b`.
    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model=model,
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-cat",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
        provider_kwargs={"base_url": ollama}
        if ollama and model and model.startswith("ollama:")
        else {},
    )


def _mock_ollama_client(tags_payload):
    """Build a context-manager-like httpx.Client mock returning the given payload."""

    response = MagicMock()
    response.json.return_value = tags_payload
    response.raise_for_status = MagicMock()

    client = MagicMock()
    client.get = MagicMock(return_value=response)
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)

    return client


class TestGetModels:
    def test_returns_ollama_catalog(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        tags = {
            "models": [
                {"name": "llama3.2:3b"},
                {"name": "qwen2.5:7b"},
                {"name": "phi3.5:3.8b"},
            ]
        }

        with patch(
            "claudebox.agent_session._providers.httpx.Client",
            return_value=_mock_ollama_client(tags),
        ):
            models = runtime.get_models()

        ids = [m.id for m in models]
        assert ids == ["llama3.2:3b", "qwen2.5:7b", "phi3.5:3.8b"]
        # Context-window mapped from MODEL_CONTEXT_WINDOW table.
        assert next(m for m in models if m.id == "qwen2.5:7b").context_window == 32_768

    def test_caches_at_instance_level(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        tags = {"models": [{"name": "llama3.2:3b"}]}
        mock_client = _mock_ollama_client(tags)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=mock_client):
            runtime.get_models()
            runtime.get_models()

        # First call hits httpx; the cached path skips it.
        assert mock_client.get.call_count == 1

    def test_degrades_to_empty_on_connect_error(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        mock_client = MagicMock()
        mock_client.get.side_effect = httpx.ConnectError("connection refused")
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=None)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=mock_client):
            models = runtime.get_models()

        assert models == []

    def test_returns_empty_when_no_ollama_url(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path, ollama=None))

        # No Ollama URL configured (e.g. vLLM-only workspace) -> empty catalog at v1.
        assert runtime.get_models() == []

    def test_unknown_model_gets_default_context_window(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))
        tags = {"models": [{"name": "completely-new-model:42b"}]}

        with patch(
            "claudebox.agent_session._providers.httpx.Client",
            return_value=_mock_ollama_client(tags),
        ):
            models = runtime.get_models()

        assert models[0].context_window == MODEL_CONTEXT_WINDOW["default"]


class TestEmptyCatalogs:
    """get_skills/effort_levels/permission_modes return [] under LangGraph v1."""

    def test_get_skills_returns_isolated_dirs(self, tmp_path):
        """LangGraph's get_skills walks the same SKILL.md catalog Claude does.

        Passing isolated dirs proves the runtime delegates to the shared
        `walk_skills` helper rather than returning an always-empty stub.
        """

        cmds = tmp_path / "commands"
        skills_dir = tmp_path / "skills"
        (skills_dir / "alpha").mkdir(parents=True)
        (skills_dir / "alpha" / "SKILL.md").write_text(
            "---\ndescription: a\n---\nbody", encoding="utf-8"
        )

        skills = LangGraphRuntime.get_skills(commands_dir=cmds, skills_dir=skills_dir)

        assert [s.name for s in skills] == ["alpha"]

    def test_get_effort_levels_empty(self, tmp_path):
        assert LangGraphRuntime(_config(tmp_path)).get_effort_levels() == []

    def test_get_permission_modes_empty(self, tmp_path):
        assert LangGraphRuntime(_config(tmp_path)).get_permission_modes() == []


class TestDefaults:
    def test_get_default_model_classmethod_returns_empty_string(self):
        """LangGraph has no class-level default model - workspace TOML supplies the value via dispatch."""

        assert LangGraphRuntime.get_default_model() == ""

    def test_get_default_effort_level_returns_empty_string(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        assert runtime.get_default_effort_level() == ""

    def test_get_default_permission_mode_returns_empty_string(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path))

        assert runtime.get_default_permission_mode() == ""


class TestModelContextWindow:
    @pytest.mark.parametrize(
        "model_id,expected",
        [
            ("llama3.2:3b", 128_000),
            ("qwen2.5:7b", 32_768),
            ("mistral:7b", 32_768),
            ("phi3.5:3.8b", 128_000),
        ],
    )
    def test_known_model_returns_table_value(self, model_id, expected):
        assert LangGraphRuntime.get_model_context_window(model_id) == expected

    def test_unknown_model_returns_default(self):
        assert (
            LangGraphRuntime.get_model_context_window("completely-new-model:42b")
            == (MODEL_CONTEXT_WINDOW["default"])
        )
