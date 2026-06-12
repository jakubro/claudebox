"""ProviderSpec parsing + install_hint helper + strategy dispatch + lookup helpers - universal-provider plumbing tests."""

from unittest.mock import MagicMock, patch

import httpx
import pytest

from claudebox.agent_session._providers import (
    DEFAULT_STRATEGY,
    MODEL_CONTEXT_WINDOW,
    PRICE_PER_MTOK,
    PROVIDER_EXTRAS,
    PROVIDER_STRATEGIES,
    ProviderSpec,
    ProviderStrategy,
    _fetch_ollama_catalog,
    _fetch_openai_catalog,
    _probe_ollama,
    _probe_openai_compatible,
    install_hint,
    lookup_context_window,
    lookup_price,
)
from claudebox.agent_session.catalogs import Model
from claudebox.agent_session.errors import (
    OllamaModelNotPulled,
    OllamaUnreachable,
    OpenAICompatibleUnreachable,
)


class TestProviderSpecParse:
    def test_parses_normal_form(self):
        spec = ProviderSpec.parse("anthropic:claude-sonnet-4-5", {})

        assert spec.provider == "anthropic"
        assert spec.model_id == "claude-sonnet-4-5"
        assert spec.full_id == "anthropic:claude-sonnet-4-5"
        assert spec.kwargs == {}

    def test_parses_ollama_with_colon_in_model_id(self):
        """Ollama model ids contain colons (e.g. llama3.2:3b) - partition keeps everything after the first colon."""

        spec = ProviderSpec.parse("ollama:llama3.2:3b", {})

        assert spec.provider == "ollama"
        assert spec.model_id == "llama3.2:3b"
        assert spec.full_id == "ollama:llama3.2:3b"

    def test_forwards_kwargs_verbatim(self):
        kwargs = {"base_url": "http://x:11434", "temperature": 0.5}
        spec = ProviderSpec.parse("openai:gpt-4o", kwargs)

        assert spec.kwargs == kwargs
        # Frozen dataclass - kwargs reference is the same dict the caller passed in.
        assert spec.kwargs is kwargs

    def test_rejects_bare_model_id_no_colon(self):
        """parse() requires the explicit `provider:model` form; no-colon strings raise.

        Workspace TOML must declare `[langgraph] model = "ollama:llama3.2:3b"`
        (or `"anthropic:claude-sonnet-4-5"`, etc.) - the bare model-id form
        is rejected so misconfiguration surfaces at session start with an
        actionable error instead of failing at init_chat_model time.
        """

        with pytest.raises(ValueError, match="provider:model"):
            ProviderSpec.parse("simple-no-colon-name", {})

    def test_accepts_bare_ollama_model_id_with_internal_colons_garbage_in_garbage_out(self):
        """A bare ollama-shaped model id (with internal colons) parses but produces wrong fields.

        `partition(":")` splits on the FIRST colon. For `"llama3.2:3b"`,
        provider becomes `"llama3.2"` and model_id becomes `"3b"`, which
        is semantically wrong. Documented behaviour: users must write the
        explicit `ollama:` form. The garbage-in-garbage-out case here
        ensures init_chat_model fails loudly at construction (no registered
        `llama3.2` provider package) rather than silently routing to a
        wrong target.
        """

        spec = ProviderSpec.parse("llama3.2:3b", {})

        # Documents the misparse - users hitting this should see init_chat_model
        # fail loudly because "llama3.2" is not a registered provider package.
        assert spec.provider == "llama3.2"
        assert spec.model_id == "3b"

    def test_rejects_empty_provider(self):
        with pytest.raises(ValueError, match="provider:model"):
            ProviderSpec.parse(":model-id", {})

    def test_rejects_empty_model_id(self):
        with pytest.raises(ValueError, match="provider:model"):
            ProviderSpec.parse("anthropic:", {})

    def test_rejects_empty_string(self):
        with pytest.raises(ValueError, match="provider:model"):
            ProviderSpec.parse("", {})

    def test_frozen_dataclass(self):
        spec = ProviderSpec.parse("anthropic:claude-sonnet-4-5", {})

        with pytest.raises(
            Exception
        ):  # FrozenInstanceError subclasses dataclasses.FrozenInstanceError
            spec.provider = "other"  # ty: ignore[invalid-assignment]


class TestInstallHint:
    def test_curated_hint_points_at_image_rebuild(self):
        hint = install_hint("anthropic")
        assert "anthropic" in hint
        assert "claudebox build --layer agent" in hint
        assert "pip install" not in hint

    def test_every_curated_provider_hint_names_rebuild(self):
        for provider in PROVIDER_EXTRAS:
            assert "claudebox build --layer agent" in install_hint(provider)

    def test_fallback_for_unknown_provider(self):
        """Unknown providers name the bare langchain-<provider> package to add to langgraph-all."""

        hint = install_hint("future_provider")
        assert "langchain-future-provider" in hint
        assert "pip install" not in hint

    def test_fallback_translates_underscores_to_hyphens(self):
        """LangChain's package naming uses hyphens (langchain-google-genai), not underscores."""

        assert "langchain-some-long-provider-name" in install_hint("some_long_provider_name")

    def test_table_has_tier1_cloud_providers(self):
        """Sanity check the extras map covers every Tier 1 cloud provider (ollama is a core dep)."""

        for provider in ("anthropic", "openai"):
            assert provider in PROVIDER_EXTRAS, (
                f"Tier 1 provider {provider!r} missing from PROVIDER_EXTRAS"
            )


# ----------------------------------------------------------------------------
# Section 2 - ProviderStrategy registry + per-provider probes + catalogs (.b)
# ----------------------------------------------------------------------------


def _httpx_client_mock(
    *,
    json_payload: dict | None = None,
    status_code: int = 200,
    raise_on_get: Exception | None = None,
    raise_on_post: Exception | None = None,
    post_status_code: int | None = None,
) -> MagicMock:
    response = MagicMock()
    response.status_code = status_code
    response.json.return_value = json_payload or {}
    response.raise_for_status = MagicMock()

    post_response = MagicMock()
    post_response.status_code = post_status_code if post_status_code is not None else status_code
    post_response.json.return_value = json_payload or {}
    post_response.raise_for_status = MagicMock()

    client = MagicMock()
    client.__enter__ = MagicMock(return_value=client)
    client.__exit__ = MagicMock(return_value=None)

    if raise_on_get is not None:
        client.get.side_effect = raise_on_get
    else:
        client.get.return_value = response

    if raise_on_post is not None:
        client.post.side_effect = raise_on_post
    else:
        client.post.return_value = post_response

    return client


class TestProviderStrategy:
    """The PROVIDER_STRATEGIES registry routes per-provider behaviour."""

    def test_ollama_strategy_carries_probe_and_catalog(self):
        strategy = PROVIDER_STRATEGIES["ollama"]

        assert strategy.probe is _probe_ollama
        assert strategy.fetch_catalog is _fetch_ollama_catalog

    def test_openai_strategy_carries_probe_and_catalog(self):
        strategy = PROVIDER_STRATEGIES["openai"]

        assert strategy.probe is _probe_openai_compatible
        assert strategy.fetch_catalog is _fetch_openai_catalog

    def test_unknown_provider_falls_back_to_default(self):
        """Cloud providers (anthropic, google_genai, groq, mistralai, ...) have no entry."""

        for provider in ("anthropic", "google_genai", "groq", "mistralai", "future_provider"):
            assert PROVIDER_STRATEGIES.get(provider, DEFAULT_STRATEGY) is DEFAULT_STRATEGY

    def test_default_strategy_has_no_probe_or_catalog(self):
        assert DEFAULT_STRATEGY.probe is None
        assert DEFAULT_STRATEGY.fetch_catalog is None

    def test_provider_strategy_is_frozen(self):
        strategy = ProviderStrategy()

        with pytest.raises(Exception):
            strategy.probe = lambda spec: None  # ty: ignore[invalid-assignment]


class TestProbeOllama:
    """`_probe_ollama` combines reachability + model-pulled checks."""

    def _spec(self, *, base_url: str | None = "http://127.0.0.1:11434") -> ProviderSpec:
        kwargs: dict = {}

        if base_url is not None:
            kwargs["base_url"] = base_url

        return ProviderSpec.parse("ollama:llama3.2:3b", kwargs)

    def test_no_base_url_is_no_op(self):
        """No base_url -> probe skips silently (init_chat_model uses Ollama default)."""

        spec = self._spec(base_url=None)
        # No httpx patching needed - the early-return means no HTTP call.
        _probe_ollama(spec)

    def test_happy_path(self):
        client_mock = _httpx_client_mock()

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            _probe_ollama(self._spec())

    def test_reachable_failure_raises_unreachable(self):
        client_mock = _httpx_client_mock(raise_on_get=httpx.ConnectError("refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable, match="11434"):
                _probe_ollama(self._spec())

    def test_show_404_raises_model_not_pulled(self):
        """/api/show returning 404 means model is not pulled - distinct exception."""

        client_mock = _httpx_client_mock(post_status_code=404)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaModelNotPulled, match="llama3.2:3b"):
                _probe_ollama(self._spec())

    def test_show_5xx_raises_unreachable(self):
        """/api/show returning 5xx means server misbehaving - unreachable, not not-pulled."""

        client_mock = _httpx_client_mock()
        bad_response = MagicMock()
        bad_response.status_code = 500
        bad_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "boom", request=MagicMock(), response=bad_response
        )
        client_mock.post.return_value = bad_response

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable):
                _probe_ollama(self._spec())

    def test_show_timeout_raises_unreachable(self):
        client_mock = _httpx_client_mock(raise_on_post=httpx.TimeoutException("timeout"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OllamaUnreachable):
                _probe_ollama(self._spec())


class TestProbeOpenAICompatible:
    """`_probe_openai_compatible` is opt-in via `probe_on_connect` kwarg."""

    def _spec(
        self,
        *,
        base_url: str | None = "http://127.0.0.1:8000/v1",
        probe_on_connect: bool | None = None,
    ) -> ProviderSpec:
        kwargs: dict = {}

        if base_url is not None:
            kwargs["base_url"] = base_url

        if probe_on_connect is not None:
            kwargs["probe_on_connect"] = probe_on_connect

        return ProviderSpec.parse("openai:qwen2.5-7b-instruct", kwargs)

    def test_no_base_url_is_no_op(self):
        """No base_url -> probe skips silently (cloud OpenAI without explicit base)."""

        _probe_openai_compatible(self._spec(base_url=None))

    def test_off_by_default_when_probe_on_connect_absent(self):
        """`base_url` set + no probe_on_connect -> no HTTP call (default off)."""

        spec = self._spec()  # no probe_on_connect
        # No httpx patching needed - the gate should prevent any HTTP call.
        # But we patch to verify it was NOT called.
        client_mock = _httpx_client_mock()

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            _probe_openai_compatible(spec)

        client_mock.get.assert_not_called()

    def test_off_when_probe_on_connect_false(self):
        spec = self._spec(probe_on_connect=False)
        client_mock = _httpx_client_mock()

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            _probe_openai_compatible(spec)

        client_mock.get.assert_not_called()

    def test_fires_when_probe_on_connect_true(self):
        spec = self._spec(probe_on_connect=True)
        client_mock = _httpx_client_mock()

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            _probe_openai_compatible(spec)

        client_mock.get.assert_called_once()
        call_url = client_mock.get.call_args[0][0]
        assert call_url.endswith("/v1/models")

    def test_unreachable_raises_typed_error(self):
        spec = self._spec(probe_on_connect=True, base_url="http://offline:8000/v1")
        client_mock = _httpx_client_mock(raise_on_get=httpx.ConnectError("refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            with pytest.raises(OpenAICompatibleUnreachable, match="offline:8000"):
                _probe_openai_compatible(spec)

    def test_unreachable_distinct_from_ollama_unreachable(self):
        """OpenAICompatibleUnreachable must NOT collapse into OllamaUnreachable."""

        spec = self._spec(probe_on_connect=True)
        client_mock = _httpx_client_mock(raise_on_get=httpx.ConnectError("refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            try:
                _probe_openai_compatible(spec)
            except OpenAICompatibleUnreachable as exc:
                # Both inherit from ProviderError; the OpenAI-compatible one must
                # NOT also be an OllamaUnreachable so handlers can disambiguate.
                assert not isinstance(exc, OllamaUnreachable)


class TestFetchOllamaCatalog:
    """`_fetch_ollama_catalog` ports the get_models /api/tags logic."""

    def _spec(self, *, base_url: str | None = "http://127.0.0.1:11434") -> ProviderSpec:
        kwargs: dict = {}

        if base_url is not None:
            kwargs["base_url"] = base_url

        return ProviderSpec.parse("ollama:llama3.2:3b", kwargs)

    def test_no_base_url_returns_empty(self):
        assert _fetch_ollama_catalog(self._spec(base_url=None)) == []

    def test_returns_models_from_api_tags(self):
        payload = {
            "models": [
                {"name": "llama3.2:3b"},
                {"name": "qwen2.5:7b"},
            ]
        }
        client_mock = _httpx_client_mock(json_payload=payload)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = _fetch_ollama_catalog(self._spec())

        ids = [m.id for m in models]
        assert ids == ["llama3.2:3b", "qwen2.5:7b"]
        assert all(isinstance(m, Model) for m in models)

    def test_context_window_resolved_from_table(self):
        payload = {"models": [{"name": "qwen2.5:7b"}]}
        client_mock = _httpx_client_mock(json_payload=payload)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = _fetch_ollama_catalog(self._spec())

        assert models[0].context_window == MODEL_CONTEXT_WINDOW["qwen2.5:7b"]

    def test_unknown_model_id_falls_back_to_default(self):
        payload = {"models": [{"name": "custom-model:9b"}]}
        client_mock = _httpx_client_mock(json_payload=payload)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = _fetch_ollama_catalog(self._spec())

        assert models[0].context_window == MODEL_CONTEXT_WINDOW["default"]

    def test_http_error_returns_empty_silently(self):
        """Post-connect catalog calls degrade silently - connect-time probe raises."""

        client_mock = _httpx_client_mock(raise_on_get=httpx.ConnectError("refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            assert _fetch_ollama_catalog(self._spec()) == []

    def test_handles_model_key_fallback(self):
        """Ollama /api/tags entries sometimes use `model` key instead of `name`."""

        payload = {"models": [{"model": "llama3.2:3b"}]}
        client_mock = _httpx_client_mock(json_payload=payload)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = _fetch_ollama_catalog(self._spec())

        assert [m.id for m in models] == ["llama3.2:3b"]


class TestFetchOpenAICatalog:
    """`_fetch_openai_catalog` projects /v1/models into list[Model]."""

    def _spec(self, *, base_url: str | None = "http://127.0.0.1:8000/v1") -> ProviderSpec:
        kwargs: dict = {}

        if base_url is not None:
            kwargs["base_url"] = base_url

        return ProviderSpec.parse("openai:gpt-4o", kwargs)

    def test_no_base_url_returns_empty(self):
        """Cloud OpenAI without explicit base_url -> empty catalog (api.openai.com requires API key)."""

        assert _fetch_openai_catalog(self._spec(base_url=None)) == []

    def test_returns_models_from_v1_models(self):
        payload = {
            "data": [
                {"id": "gpt-4o"},
                {"id": "qwen2.5-7b-instruct"},
            ]
        }
        client_mock = _httpx_client_mock(json_payload=payload)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = _fetch_openai_catalog(self._spec())

        ids = [m.id for m in models]
        assert ids == ["gpt-4o", "qwen2.5-7b-instruct"]
        assert all(isinstance(m, Model) for m in models)

    def test_http_error_returns_empty(self):
        client_mock = _httpx_client_mock(raise_on_get=httpx.ConnectError("refused"))

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            assert _fetch_openai_catalog(self._spec()) == []

    def test_missing_data_key_returns_empty(self):
        """Malformed response (no `data` key) -> [] not crash."""

        client_mock = _httpx_client_mock(json_payload={"models": "wrong key"})

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            assert _fetch_openai_catalog(self._spec()) == []

    def test_entries_without_id_skipped(self):
        payload = {"data": [{"id": "gpt-4o"}, {}, {"id": "gpt-4o-mini"}]}
        client_mock = _httpx_client_mock(json_payload=payload)

        with patch("claudebox.agent_session._providers.httpx.Client", return_value=client_mock):
            models = _fetch_openai_catalog(self._spec())

        assert [m.id for m in models] == ["gpt-4o", "gpt-4o-mini"]


# ----------------------------------------------------------------------------
# Section 4 - Lookup helpers (.c)
# ----------------------------------------------------------------------------


class TestLookupContextWindow:
    """`lookup_context_window(spec, override)` reads MODEL_CONTEXT_WINDOW with workspace override."""

    def test_table_hit_anthropic_sonnet(self):
        spec = ProviderSpec.parse("anthropic:claude-sonnet-4-5", {})

        assert lookup_context_window(spec, None) == 200_000

    def test_table_hit_ollama_llama(self):
        spec = ProviderSpec.parse("ollama:llama3.2:3b", {})

        assert lookup_context_window(spec, None) == 128_000

    def test_default_fallback_for_unknown_model(self):
        """Unknown model id resolves to MODEL_CONTEXT_WINDOW['default']."""

        spec = ProviderSpec.parse("anthropic:unreleased-future-model", {})

        assert lookup_context_window(spec, None) == MODEL_CONTEXT_WINDOW["default"]

    def test_override_wins_over_table(self):
        """Workspace `max_tokens_override = N` short-circuits table lookup."""

        spec = ProviderSpec.parse("anthropic:claude-sonnet-4-5", {})

        assert lookup_context_window(spec, 65_536) == 65_536

    def test_override_wins_for_unknown_model_too(self):
        """Override works for models outside MODEL_CONTEXT_WINDOW - the escape hatch."""

        spec = ProviderSpec.parse("custom_org:model-42b", {})

        assert lookup_context_window(spec, 64_000) == 64_000


class TestLookupPrice:
    """`lookup_price(spec, overrides)` reads PRICE_PER_MTOK with workspace overrides."""

    def test_table_hit_anthropic_sonnet(self):
        spec = ProviderSpec.parse("anthropic:claude-sonnet-4-5", {})

        assert lookup_price(spec, {}) == {"input": 3.0, "output": 15.0}

    def test_table_hit_openai_gpt4o(self):
        spec = ProviderSpec.parse("openai:gpt-4o", {})

        assert lookup_price(spec, {}) == {"input": 2.50, "output": 10.0}

    def test_unknown_model_returns_none(self):
        """No 'default' key in PRICE_PER_MTOK - unknown models resolve to None."""

        spec = ProviderSpec.parse("anthropic:unreleased-future-model", {})

        assert lookup_price(spec, {}) is None

    def test_override_wins_over_curated_table(self):
        """Workspace `[langgraph.cost]` overrides take precedence over PRICE_PER_MTOK."""

        spec = ProviderSpec.parse("anthropic:claude-sonnet-4-5", {})
        overrides = {"claude-sonnet-4-5": {"input": 1.0, "output": 5.0}}

        assert lookup_price(spec, overrides) == {"input": 1.0, "output": 5.0}

    def test_override_works_for_unknown_model(self):
        """Overrides let users pin USD for models not in the curated table."""

        spec = ProviderSpec.parse("anthropic:custom-model", {})
        overrides = {"custom-model": {"input": 0.5, "output": 1.5}}

        assert lookup_price(spec, overrides) == {"input": 0.5, "output": 1.5}

    def test_ollama_returns_zero_not_none(self):
        """Ollama rows are explicitly in the table at 0.0 - distinct from unknown=None."""

        spec = ProviderSpec.parse("ollama:llama3.2:3b", {})

        result = lookup_price(spec, {})
        assert result == {"input": 0.0, "output": 0.0}
        assert result is not None

    def test_no_default_key_in_price_table(self):
        """PRICE_PER_MTOK must NOT carry a 'default' key - missing model -> None."""

        assert "default" not in PRICE_PER_MTOK
