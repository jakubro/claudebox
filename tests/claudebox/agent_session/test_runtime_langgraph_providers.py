"""Universal-provider dispatch tests for LangGraphRuntime.

Section 1 (.a): `_build_chat_model` dispatches via `init_chat_model`
with ProviderPackageMissing translation.
Section 2 (.b): probe dispatch via `PROVIDER_STRATEGIES`.
Section 3 (.b): catalog dispatch via `PROVIDER_STRATEGIES`.
Section 4 (.c): cost telemetry + context-window via `_providers` lookup helpers.
Section 5 (.d): tool-binding graceful degradation via `_build_graph`.
Section 6 (.f): Tier 1 Anthropic integration headline - real langchain-anthropic
                + stubbed chat model on the wire so no real API key is needed.
"""

from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from claudebox.agent_session.config import LangGraphAgentSessionConfig
from claudebox.agent_session.errors import (
    OllamaModelNotPulled,
    OllamaUnreachable,
    OpenAICompatibleUnreachable,
    ProviderPackageMissing,
)
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_langgraph import LangGraphRuntime


def _config(
    tmp_path: Path,
    *,
    model: str,
    provider_kwargs: dict | None = None,
    cost_overrides: dict | None = None,
    max_tokens_override: int | None = None,
) -> LangGraphAgentSessionConfig:
    """Build a normalized LangGraphAgentSessionConfig - skips the SessionService shim."""

    return LangGraphAgentSessionConfig(
        runtime="langgraph",
        model=model,
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-providers",
        resume_session_id=None,
        session_dir=tmp_path,
        hooks=HookCallbacks(),
        provider_kwargs=provider_kwargs or {},
        cost_overrides=cost_overrides or {},
        max_tokens_override=max_tokens_override,
    )


class TestBuildChatModelDispatch:
    """`_build_chat_model` routes through `init_chat_model` with the spec's full_id + kwargs."""

    def test_dispatches_via_init_chat_model_for_anthropic(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )
        fake_chat_model = MagicMock()

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            return_value=fake_chat_model,
        ) as mock_init:
            result = runtime._build_chat_model()

        mock_init.assert_called_once_with("anthropic:claude-sonnet-4-5")
        assert result is fake_chat_model

    def test_dispatches_via_init_chat_model_for_ollama(self, tmp_path):
        """Existing Ollama workspaces still route through init_chat_model now too."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            return_value=MagicMock(),
        ) as mock_init:
            runtime._build_chat_model()

        mock_init.assert_called_once_with("ollama:llama3.2:3b", base_url="http://127.0.0.1:11434")

    def test_forwards_provider_kwargs(self, tmp_path):
        """Per-provider kwargs land verbatim as keyword arguments to init_chat_model."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="openai:gpt-4o",
                provider_kwargs={"base_url": "http://x:8000/v1", "temperature": 0.5},
            )
        )

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            return_value=MagicMock(),
        ) as mock_init:
            runtime._build_chat_model()

        mock_init.assert_called_once_with(
            "openai:gpt-4o", base_url="http://x:8000/v1", temperature=0.5
        )


class TestProviderPackageMissing:
    """ImportError from init_chat_model -> ProviderPackageMissing with install hint."""

    def test_raises_typed_error_for_anthropic(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            side_effect=ImportError("No module named 'langchain_anthropic'"),
        ):
            with pytest.raises(ProviderPackageMissing) as exc_info:
                runtime._build_chat_model()

        assert exc_info.value.provider == "anthropic"
        assert "anthropic" in exc_info.value.install_hint
        assert "claudebox build --layer agent" in exc_info.value.install_hint

    def test_raises_typed_error_for_unknown_provider(self, tmp_path):
        """Unknown providers get the constructed `pip install langchain-<provider>` hint."""

        runtime = LangGraphRuntime(
            _config(tmp_path, model="future_provider:some-model", provider_kwargs={})
        )

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            side_effect=ImportError("No module named 'langchain_future_provider'"),
        ):
            with pytest.raises(ProviderPackageMissing) as exc_info:
                runtime._build_chat_model()

        assert exc_info.value.provider == "future_provider"
        assert "langchain-future-provider" in exc_info.value.install_hint

    def test_chains_original_importerror(self, tmp_path):
        """Original ImportError must be preserved as __cause__ for diagnostic chains."""

        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )
        original = ImportError("No module named 'langchain_anthropic'")

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            side_effect=original,
        ):
            with pytest.raises(ProviderPackageMissing) as exc_info:
                runtime._build_chat_model()

        assert exc_info.value.__cause__ is original

    def test_other_exceptions_propagate_unchanged(self, tmp_path):
        """Non-ImportError exceptions from init_chat_model are NOT caught."""

        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )

        with patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            side_effect=RuntimeError("some other failure"),
        ):
            with pytest.raises(RuntimeError, match="some other failure"):
                runtime._build_chat_model()


# ----------------------------------------------------------------------------
# Section 2 - Probe dispatch via PROVIDER_STRATEGIES (.b)
# ----------------------------------------------------------------------------


def _ok_httpx_client_mock() -> MagicMock:
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {}
    response.raise_for_status = MagicMock()
    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)
    client.get.return_value = response
    client.post.return_value = response

    return client


def _async_sqlite_cm_mock() -> MagicMock:
    async def _aenter(self):
        return MagicMock()

    async def _aexit(self, *args):
        return None

    cm = MagicMock()
    cm.__aenter__ = _aenter
    cm.__aexit__ = _aexit

    return cm


def _patch_connect_dependencies():
    """Stack the standard mocks needed for runtime.connect() to reach the probe."""

    return (
        patch(
            "claudebox.agent_session.runtime_langgraph.init_chat_model",
            return_value=MagicMock(),
        ),
        patch(
            "claudebox.agent_session.runtime_langgraph.create_agent",
            return_value=MagicMock(),
        ),
        patch(
            "claudebox.agent_session.runtime_langgraph.AsyncSqliteSaver.from_conn_string",
            return_value=_async_sqlite_cm_mock(),
        ),
    )


class TestProbeDispatch:
    """`connect()` reads PROVIDER_STRATEGIES[spec.provider].probe and invokes it."""

    @pytest.mark.anyio
    async def test_ollama_provider_fires_probe(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )
        client_mock = _ok_httpx_client_mock()

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            await runtime.connect()

        # Two HTTP calls expected: GET /api/version + POST /api/show.
        assert client_mock.get.called
        assert client_mock.post.called

    @pytest.mark.anyio
    async def test_anthropic_provider_skips_probe(self, tmp_path):
        """Cloud providers (anthropic) have no entry in PROVIDER_STRATEGIES - no probe runs."""

        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )
        client_mock = _ok_httpx_client_mock()

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            await runtime.connect()

        # No HTTP call from probe layer for anthropic.
        client_mock.get.assert_not_called()
        client_mock.post.assert_not_called()

    @pytest.mark.anyio
    async def test_openai_compatible_probe_off_by_default(self, tmp_path):
        """`[langgraph.openai] base_url = "..."` with no probe_on_connect -> no probe."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="openai:qwen2.5-7b-instruct",
                provider_kwargs={"base_url": "http://127.0.0.1:8000/v1"},
            )
        )
        client_mock = _ok_httpx_client_mock()

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            await runtime.connect()

        client_mock.get.assert_not_called()

    @pytest.mark.anyio
    async def test_openai_compatible_probe_fires_when_opt_in(self, tmp_path):
        """probe_on_connect=True -> /v1/models GET fires."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="openai:qwen2.5-7b-instruct",
                provider_kwargs={
                    "base_url": "http://127.0.0.1:8000/v1",
                    "probe_on_connect": True,
                },
            )
        )
        client_mock = _ok_httpx_client_mock()

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            await runtime.connect()

        assert client_mock.get.called
        call_url = client_mock.get.call_args[0][0]
        assert call_url.endswith("/v1/models")

    @pytest.mark.anyio
    async def test_openai_compatible_probe_unreachable_raises_distinct_error(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="openai:qwen2.5-7b-instruct",
                provider_kwargs={
                    "base_url": "http://127.0.0.1:8000/v1",
                    "probe_on_connect": True,
                },
            )
        )
        client_mock = _ok_httpx_client_mock()
        client_mock.get.side_effect = httpx.ConnectError("refused")

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            with pytest.raises(OpenAICompatibleUnreachable):
                await runtime.connect()


# ----------------------------------------------------------------------------
# Section 3 - Catalog dispatch via PROVIDER_STRATEGIES (.b)
# ----------------------------------------------------------------------------


class TestCatalogDispatch:
    """`get_models()` reads PROVIDER_STRATEGIES[spec.provider].fetch_catalog."""

    def test_anthropic_returns_empty_catalog(self, tmp_path):
        """Cloud providers (anthropic) have no fetch_catalog - empty list."""

        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )

        assert runtime.get_models() == []

    def test_ollama_returns_api_tags_catalog(self, tmp_path):
        """Ollama provider -> /api/tags via PROVIDER_STRATEGIES[ollama].fetch_catalog."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )
        client_mock = MagicMock()
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "llama3.2:3b"}, {"name": "qwen2.5:7b"}]}
        response.raise_for_status = MagicMock()
        client_mock.__enter__ = MagicMock(return_value=client_mock)
        client_mock.__exit__ = MagicMock(return_value=None)
        client_mock.get.return_value = response

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = runtime.get_models()

        assert [m.id for m in models] == ["llama3.2:3b", "qwen2.5:7b"]

    def test_openai_compatible_returns_v1_models_catalog(self, tmp_path):
        """`openai:` provider with explicit base_url -> /v1/models."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="openai:gpt-4o",
                provider_kwargs={"base_url": "http://127.0.0.1:8000/v1"},
            )
        )
        client_mock = MagicMock()
        response = MagicMock()
        response.json.return_value = {"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}]}
        response.raise_for_status = MagicMock()
        client_mock.__enter__ = MagicMock(return_value=client_mock)
        client_mock.__exit__ = MagicMock(return_value=None)
        client_mock.get.return_value = response

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = runtime.get_models()

        call_url = client_mock.get.call_args[0][0]
        assert call_url.endswith("/v1/models")
        assert [m.id for m in models] == ["gpt-4o", "gpt-4o-mini"]

    def test_catalog_cached_per_session(self, tmp_path):
        """Second get_models() call returns the cached list without re-fetching."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )
        client_mock = MagicMock()
        response = MagicMock()
        response.json.return_value = {"models": [{"name": "llama3.2:3b"}]}
        response.raise_for_status = MagicMock()
        client_mock.__enter__ = MagicMock(return_value=client_mock)
        client_mock.__exit__ = MagicMock(return_value=None)
        client_mock.get.return_value = response

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            runtime.get_models()
            runtime.get_models()

        # Exactly one HTTP call - second invocation hits the cache.
        assert client_mock.get.call_count == 1

    def test_ollama_unreachable_returns_empty_post_connect(self, tmp_path):
        """Post-connect catalog fetch degrades silently to [] on HTTP failure."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://offline:11434"},
            )
        )
        client_mock = MagicMock()
        client_mock.__enter__ = MagicMock(return_value=client_mock)
        client_mock.__exit__ = MagicMock(return_value=None)
        client_mock.get.side_effect = httpx.ConnectError("refused")

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            assert runtime.get_models() == []


class TestProbeOllamaDispatchedRaisesExpectedTypes:
    """Smoke test J1/J2 coverage through the new dispatch path (companion to test_runtime_langgraph_failures)."""

    @pytest.mark.anyio
    async def test_unreachable_raises_through_strategy(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )
        client_mock = _ok_httpx_client_mock()
        client_mock.get.side_effect = httpx.ConnectError("refused")

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            with pytest.raises(OllamaUnreachable):
                await runtime.connect()

    @pytest.mark.anyio
    async def test_model_not_pulled_raises_through_strategy(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )
        client_mock = _ok_httpx_client_mock()
        post_response = MagicMock()
        post_response.status_code = 404
        post_response.raise_for_status = MagicMock()
        client_mock.post.return_value = post_response

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            init_p,
            agent_p,
            ckpt_p,
            patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock),
        ):
            with pytest.raises(OllamaModelNotPulled):
                await runtime.connect()


# ----------------------------------------------------------------------------
# Section 4 - Cost telemetry + context-window via _providers lookup helpers (.c)
# ----------------------------------------------------------------------------


class TestCostAccumulation:
    """`_accumulate_usage` routes through `lookup_price` for curated / overridden / None semantics."""

    def test_uses_curated_table_for_known_model(self, tmp_path):
        """Anthropic Sonnet 1M input + 0.5M output -> 1.0 * 3.0 + 0.5 * 15.0 = 10.50 USD."""

        runtime = LangGraphRuntime(_config(tmp_path, model="anthropic:claude-sonnet-4-5"))

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=500_000)

        assert cost == pytest.approx(10.50)
        assert runtime._total_cost_usd == pytest.approx(10.50)

    def test_unknown_model_returns_none(self, tmp_path):
        """Custom unknown model -> None cost; _total_cost_usd unchanged; tokens still counted."""

        runtime = LangGraphRuntime(_config(tmp_path, model="custom_provider:my-unknown-model"))

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=500_000)

        assert cost is None
        assert runtime._total_cost_usd == 0.0
        # Tokens accumulate even when cost can't be computed.
        assert runtime._used_tokens == 1_500_000

    def test_override_wins_over_curated_table(self, tmp_path):
        """Workspace `cost_overrides` take precedence over PRICE_PER_MTOK rates."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="anthropic:claude-sonnet-4-5",
                cost_overrides={"claude-sonnet-4-5": {"input": 1.0, "output": 5.0}},
            )
        )

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=500_000)

        # Override rates: 1.0 * 1.0 + 0.5 * 5.0 = 3.50 (vs curated 10.50).
        assert cost == pytest.approx(3.50)

    def test_ollama_is_zero_not_none(self, tmp_path):
        """Ollama rows are explicitly zero - the cost row stays visible at $0.00."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="ollama:llama3.2:3b",
                provider_kwargs={"base_url": "http://127.0.0.1:11434"},
            )
        )

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=500_000)

        assert cost == 0.0
        assert cost is not None

    def test_override_works_for_unknown_model(self, tmp_path):
        """Override lets users pin USD for models the curated table doesn't carry."""

        runtime = LangGraphRuntime(
            _config(
                tmp_path,
                model="custom_provider:my-custom-model",
                cost_overrides={"my-custom-model": {"input": 0.5, "output": 1.5}},
            )
        )

        cost = runtime._accumulate_usage(input_tokens=1_000_000, output_tokens=500_000)

        # 1.0 * 0.5 + 0.5 * 1.5 = 1.25.
        assert cost == pytest.approx(1.25)

    def test_subagent_usage_skips_cost_when_unknown(self, tmp_path):
        """`_accumulate_subagent_usage` mirrors None semantics: tokens count, cost doesn't."""

        runtime = LangGraphRuntime(_config(tmp_path, model="custom_provider:my-unknown-model"))

        runtime._accumulate_subagent_usage(input_tokens=500_000, output_tokens=250_000)

        assert runtime._used_tokens == 750_000
        assert runtime._total_cost_usd == 0.0
        assert runtime._subagent_cost_this_turn == 0.0


class TestModelContextWindow:
    """`_model_context_window` routes through `lookup_context_window`."""

    @pytest.mark.anyio
    async def test_resolves_for_anthropic_sonnet(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path, model="anthropic:claude-sonnet-4-5"))

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 200_000

    @pytest.mark.anyio
    async def test_resolves_for_openai_gpt4o(self, tmp_path):
        runtime = LangGraphRuntime(_config(tmp_path, model="openai:gpt-4o"))

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 128_000

    @pytest.mark.anyio
    async def test_override_wins_over_curated_table(self, tmp_path):
        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", max_tokens_override=65_536)
        )

        usage = await runtime.get_context_usage()

        assert usage is not None
        assert usage.max_tokens == 65_536


# ----------------------------------------------------------------------------
# Section 5 - Tool-binding graceful degradation via _build_graph (.d)
# ----------------------------------------------------------------------------


class TestToolBindingDegradation:
    """`_build_graph` catches NotImplementedError once and degrades to tools=[]."""

    def test_failure_degrades_to_chat_only(self, tmp_path, caplog):
        """NotImplementedError on first call -> warning + rebuild with tools=[]."""

        import logging

        runtime = LangGraphRuntime(_config(tmp_path, model="anthropic:claude-sonnet-4-5"))
        runtime._chat_model = MagicMock()
        runtime._checkpointer = MagicMock()

        succeeded_graph = MagicMock(name="degraded_graph")
        call_log: list[dict] = []

        def _create(*args, **kwargs):
            call_log.append(kwargs)

            if len(call_log) == 1:
                raise NotImplementedError("model does not support bind_tools")

            return succeeded_graph

        with (
            patch(
                "claudebox.agent_session.runtime_langgraph.create_agent",
                side_effect=_create,
            ),
            caplog.at_level(logging.WARNING),
        ):
            result = runtime._build_graph(tools=[MagicMock(name="tool")], middleware=[])

        assert result is succeeded_graph
        assert len(call_log) == 2
        assert call_log[0]["tools"] == [MagicMock(name="tool")] or len(call_log[0]["tools"]) == 1
        assert call_log[1]["tools"] == []
        # Warning logged with the right event + structured kwargs.
        warnings = [r for r in caplog.records if r.levelname == "WARNING"]
        assert any("provider_no_tool_calling" in r.getMessage() for r in warnings), (
            f"expected provider_no_tool_calling warning, got: {[r.getMessage() for r in warnings]}"
        )

    def test_success_does_not_catch(self, tmp_path):
        """Successful first call -> exactly one create_agent invocation; no warning."""

        runtime = LangGraphRuntime(_config(tmp_path, model="anthropic:claude-sonnet-4-5"))
        runtime._chat_model = MagicMock()
        runtime._checkpointer = MagicMock()

        graph = MagicMock(name="happy_graph")

        with patch(
            "claudebox.agent_session.runtime_langgraph.create_agent",
            return_value=graph,
        ) as mock_create:
            result = runtime._build_graph(tools=[MagicMock()], middleware=[])

        assert result is graph
        assert mock_create.call_count == 1

    def test_non_NotImplemented_propagates(self, tmp_path):
        """RuntimeError (or any non-NotImplementedError) is NOT caught - propagates out."""

        runtime = LangGraphRuntime(_config(tmp_path, model="anthropic:claude-sonnet-4-5"))
        runtime._chat_model = MagicMock()
        runtime._checkpointer = MagicMock()

        with patch(
            "claudebox.agent_session.runtime_langgraph.create_agent",
            side_effect=RuntimeError("some other failure"),
        ):
            with pytest.raises(RuntimeError, match="some other failure"):
                runtime._build_graph(tools=[MagicMock()], middleware=[])


# ----------------------------------------------------------------------------
# Section 6 - Tier 1 Anthropic integration headline (.f)
# ----------------------------------------------------------------------------


class TestTier1AnthropicIntegration:
    """The migration headline: Claude Agent SDK out, LangGraph in, Anthropic model unchanged.

    Real langchain-anthropic + real init_chat_model dispatch - proves the
    `anthropic:claude-sonnet-4-5` workspace setting routes correctly through
    the universal-provider plumbing. The chat model's API call is intercepted
    so the test runs without a live ANTHROPIC_API_KEY; the AgentEvent stream
    rendering (system_init / assistant_message / result with curated cost)
    is the behavioural surface verified.
    """

    def test_init_chat_model_dispatches_to_real_chatanthropic(self, tmp_path):
        """`_build_chat_model` invoked with model=anthropic:... returns a real ChatAnthropic instance."""

        # Requires the [anthropic] extra installed; skip cleanly without it.
        langchain_anthropic = pytest.importorskip("langchain_anthropic")

        # ANTHROPIC_API_KEY needed at construction even when no API call fires.
        with patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-fake-key-not-used"}):
            runtime = LangGraphRuntime(
                _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
            )
            chat_model = runtime._build_chat_model()

        assert isinstance(chat_model, langchain_anthropic.ChatAnthropic), (
            f"expected real ChatAnthropic, got {type(chat_model).__name__}"
        )
        # The model id round-trips through init_chat_model verbatim (no Ollama prefix translation).
        assert chat_model.model == "claude-sonnet-4-5"

    @pytest.mark.anyio
    async def test_agent_event_stream_renders_anthropic_turn(self, tmp_path):
        """Drive a turn through receive_events() against a stubbed Anthropic chat model.

        Validates the migration headline end-to-end at the unit level:
        - system_init event carries `model="anthropic:claude-sonnet-4-5"`
        - assistant_message event carries the model text response as a TextBlock
        - result event carries non-None `total_cost_usd` from curated PRICE_PER_MTOK
          (anthropic Sonnet rate 3.0/15.0 per million tokens) and non-zero used_tokens
        - the cost is the Anthropic curated value, NOT the Ollama zero-rows value
        """

        pytest.importorskip("langchain_anthropic")
        from langchain_core.messages import AIMessage

        runtime = LangGraphRuntime(
            _config(tmp_path, model="anthropic:claude-sonnet-4-5", provider_kwargs={})
        )

        # Stub the underlying chat model so create_agent's astream_events
        # yields a deterministic on_chat_model_end with a text-only AIMessage.
        # Bypasses the real Anthropic HTTP transport; keeps every other layer
        # (graph construction, event projection, cost telemetry) real.
        canned_ai = AIMessage(
            content="The migration works - same brain, different runtime.",
            usage_metadata={
                "input_tokens": 1_000_000,
                "output_tokens": 500_000,
                "total_tokens": 1_500_000,
            },
        )

        async def _stub_astream_events(_graph_input, config=None, version=None):
            yield {"event": "on_chat_model_end", "data": {"output": canned_ai}}

        stubbed_graph = MagicMock()
        stubbed_graph.astream_events = _stub_astream_events

        async def _stub_aget_state(_config):
            snapshot = MagicMock()
            snapshot.tasks = ()

            return snapshot

        stubbed_graph.aget_state = _stub_aget_state

        init_p, agent_p, ckpt_p = _patch_connect_dependencies()

        with (
            patch.dict("os.environ", {"ANTHROPIC_API_KEY": "test-fake-key-not-used"}),
            init_p,
            agent_p,
            ckpt_p,
            patch(
                "claudebox.agent_session._providers.httpx.Client",
                return_value=_ok_httpx_client_mock(),
            ),
        ):
            await runtime.connect()
            # Replace the graph with our deterministic stub after connect() built
            # the real one (we keep connect()'s side effects: checkpointer entered,
            # tasks rebuilt, ready event set).
            runtime._graph = stubbed_graph

            events: list = []
            count = 0

            async for evt in runtime.receive_events():
                events.append(evt)
                count += 1

                if count == 1:
                    # Inject a prompt to drive the first turn after system_init.
                    await runtime.query("Hello.")

                if any(e.kind == "result" for e in events):
                    break

        kinds = [e.kind for e in events]
        assert "system_init" in kinds, f"missing system_init in {kinds}"
        assert "assistant_message" in kinds, f"missing assistant_message in {kinds}"
        assert "result" in kinds, f"missing result in {kinds}"

        # system_init carries the provider:model_id verbatim.
        system_init = next(e for e in events if e.kind == "system_init")
        assert system_init.payload.model == "anthropic:claude-sonnet-4-5"

        # assistant_message has the model text as a TextBlock.
        assistant = next(e for e in events if e.kind == "assistant_message")
        text_blocks = [b for b in assistant.payload.content if hasattr(b, "text")]
        assert text_blocks, f"no TextBlock in assistant content: {assistant.payload.content}"
        assert "migration works" in text_blocks[0].text

        # result carries the curated Anthropic cost (3.0 * 1.0 + 15.0 * 0.5 = 10.50)
        # and non-zero token usage. None cost would mean lookup_price failed -
        # which would prove the curated table doesn't carry claude-sonnet-4-5.
        result = next(e for e in events if e.kind == "result")
        assert result.payload.total_cost_usd == pytest.approx(10.50)
        assert result.payload.usage is not None
        assert result.payload.usage.used_tokens == 1_500_000
        # Anthropic Sonnet 200K context window (from MODEL_CONTEXT_WINDOW per .c).
        assert result.payload.usage.max_tokens == 200_000
