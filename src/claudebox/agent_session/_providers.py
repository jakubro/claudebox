"""Universal-provider plumbing for LangGraphRuntime.

Holds the parse-time provider identity, install-hint surface, per-provider
probe + catalog strategy registry, the curated context-window + price tables,
and their lookup helpers. See ARCHITECTURE.md section 1.4 for the design.

Surface:

- `ProviderSpec` dataclass + `parse()` classmethod.
- `PROVIDER_EXTRAS` map + `install_hint(provider)` helper.
- `ProviderStrategy` + `PROVIDER_STRATEGIES` registry + per-provider probe /
  catalog functions.
- `MODEL_CONTEXT_WINDOW` per-model token table + `lookup_context_window(spec,
  override)` helper.
- `PRICE_PER_MTOK` per-model USD-per-million-token table + `lookup_price(spec,
  overrides)` helper. Unknown models resolve to `None` price so the frontend
  hides the cost row; Ollama rows are zero (local compute carries no real
  USD).

This module imports `httpx` only - NO `langchain_*` packages. The ast-grep
prefix-pattern rule that bounds provider-package containment is therefore
unaffected: provider-package lazy loading happens inside `init_chat_model`
at runtime, never at `_providers.py` import time.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Self

import httpx

from .catalogs import Model
from .errors import OllamaModelNotPulled, OllamaUnreachable, OpenAICompatibleUnreachable


@dataclass(frozen=True)
class ProviderSpec:
    """Parsed provider identity for a workspace's model selection.

    Built ONCE in `LangGraphRuntime.__init__()` from the workspace TOML's
    `[langgraph] model = "provider:model"` value plus the per-provider kwargs
    composed by `SessionService.start()` from `[langgraph.<provider>]`.

    Attributes:
        provider: Bare provider name as init_chat_model expects ("anthropic",
            "openai", "ollama", "google_genai", ...).
        model_id: Bare model id with no provider prefix ("claude-sonnet-4-5",
            "llama3.2:3b", "gpt-4o", ...).
        full_id: Composite "provider:model_id" forwarded to init_chat_model.
            Equals raw_model passed to parse().
        kwargs: Forwarded verbatim to init_chat_model. Only the keys the
            provider's Chat<X> constructor accepts make sense; unknown keys
            raise at provider init.
    """

    provider: str
    model_id: str
    full_id: str
    kwargs: dict[str, Any]

    @classmethod
    def parse(cls, raw_model: str, kwargs: dict[str, Any]) -> Self:
        """Parse a `provider:model_id` string into a frozen ProviderSpec.

        Requires the explicit `provider:model` form. Bare strings (no colon)
        and malformed inputs raise ValueError so workspace TOML mistakes
        surface immediately at session start instead of failing at
        init_chat_model time.
        """

        provider, separator, model_id = raw_model.partition(":")

        if not separator or not provider or not model_id:
            raise ValueError(f"ProviderSpec.parse requires 'provider:model'; got {raw_model!r}")

        return cls(provider=provider, model_id=model_id, full_id=raw_model, kwargs=kwargs)


@dataclass(frozen=True)
class ProviderStrategy:
    """Per-provider connect-time probe + catalog enumeration handlers.

    Both fields are optional. A `None` `probe` means the provider has no
    connect-time pre-flight (cloud providers like Anthropic / OpenAI / Google
    surface auth/network errors naturally on the first `query()`). A `None`
    `fetch_catalog` means `get_models()` returns `[]` for the provider - the
    workspace TOML's `[langgraph] model = "..."` is the only source of the
    active model id; the frontend's model picker shows an empty list.

    ONE registry, no if/elif chains in `connect()` or `get_models()`. Adding
    a new provider with custom probe/catalog = adding a registry entry. No
    new runtime method, no edit to `connect()` body, no if/elif extension.
    """

    probe: Callable[[ProviderSpec], None] | None = None
    fetch_catalog: Callable[[ProviderSpec], list[Model]] | None = None


# Per-model context-window table. LangChain doesn't expose context_window
# uniformly across providers, so a hardcoded registry is the realistic v1
# design. Lookup keyed by bare `model_id` (no provider prefix). Unknown
# models fall back to `"default"`; workspaces with `max_tokens_override`
# short-circuit the lookup via `lookup_context_window`.
MODEL_CONTEXT_WINDOW: dict[str, int] = {
    # Ollama
    "llama3.2:1b": 128_000,
    "llama3.2:3b": 128_000,
    "llama3.1:8b": 128_000,
    "llama3.1:70b": 128_000,
    "qwen2.5:3b": 32_768,
    "qwen2.5:7b": 32_768,
    "qwen2.5:14b": 32_768,
    "qwen2.5:32b": 32_768,
    "mistral:7b": 32_768,
    "phi3.5:3.8b": 128_000,
    # Anthropic
    "claude-opus-4-8": 1_000_000,
    "claude-sonnet-4-5": 200_000,
    "claude-haiku-4-5-20251001": 200_000,
    # OpenAI
    "gpt-4o": 128_000,
    "gpt-4o-mini": 128_000,
    "o1": 200_000,
    "o3": 200_000,
    "o3-mini": 200_000,
    "o4-mini": 200_000,
    # Google Gemini
    "gemini-2.5-pro": 2_000_000,
    "gemini-2.5-flash": 1_000_000,
    "gemini-2.0-pro": 2_000_000,
    "gemini-2.0-flash": 1_000_000,
    "gemini-1.5-pro": 2_000_000,
    "gemini-1.5-flash": 1_000_000,
    # Groq
    "llama-3.3-70b-versatile": 128_000,
    "llama-3.1-8b-instant": 128_000,
    "mixtral-8x7b-32768": 32_768,
    # Mistral
    "mistral-large-latest": 128_000,
    "mistral-medium-latest": 128_000,
    "mistral-small-latest": 128_000,
    "codestral-latest": 256_000,
    "default": 128_000,
}


# Per-model USD-per-million-token price table. Lookup keyed by bare
# `model_id` (no provider prefix). Unknown models resolve to `None` via
# `lookup_price` so `_accumulate_usage` returns `None` and the projection's
# `total_cost_usd` stays unset for the turn (frontend hides the cost row).
# Ollama rows are explicitly zero - local compute carries no real USD, but
# zero is a deliberate "in the table" signal distinct from "missing".
# Maintenance: cloud rates need periodic updates on each provider's
# pricing-change cadence; each update is a small change touching only this
# dict.
PRICE_PER_MTOK: dict[str, dict[str, float]] = {
    # Ollama (local compute, no real USD - explicit zero rows)
    "llama3.2:1b": {"input": 0.0, "output": 0.0},
    "llama3.2:3b": {"input": 0.0, "output": 0.0},
    "llama3.1:8b": {"input": 0.0, "output": 0.0},
    "llama3.1:70b": {"input": 0.0, "output": 0.0},
    "qwen2.5:3b": {"input": 0.0, "output": 0.0},
    "qwen2.5:7b": {"input": 0.0, "output": 0.0},
    "qwen2.5:14b": {"input": 0.0, "output": 0.0},
    "qwen2.5:32b": {"input": 0.0, "output": 0.0},
    "mistral:7b": {"input": 0.0, "output": 0.0},
    "phi3.5:3.8b": {"input": 0.0, "output": 0.0},
    # Anthropic
    "claude-opus-4-8": {"input": 15.0, "output": 75.0},
    "claude-sonnet-4-5": {"input": 3.0, "output": 15.0},
    "claude-haiku-4-5-20251001": {"input": 0.80, "output": 4.0},
    # OpenAI
    "gpt-4o": {"input": 2.50, "output": 10.0},
    "gpt-4o-mini": {"input": 0.15, "output": 0.60},
    "o3": {"input": 10.0, "output": 40.0},
    "o3-mini": {"input": 1.10, "output": 4.40},
    "o4-mini": {"input": 1.10, "output": 4.40},
    # Google Gemini
    "gemini-2.5-pro": {"input": 1.25, "output": 5.0},
    "gemini-2.5-flash": {"input": 0.30, "output": 2.50},
    "gemini-2.0-flash": {"input": 0.10, "output": 0.40},
    "gemini-1.5-pro": {"input": 1.25, "output": 5.0},
    "gemini-1.5-flash": {"input": 0.075, "output": 0.30},
    # Groq
    "llama-3.3-70b-versatile": {"input": 0.59, "output": 0.79},
    "llama-3.1-8b-instant": {"input": 0.05, "output": 0.08},
    # Mistral
    "mistral-large-latest": {"input": 2.0, "output": 6.0},
    "mistral-medium-latest": {"input": 0.40, "output": 2.0},
    "mistral-small-latest": {"input": 0.20, "output": 0.60},
    # NO "default" key - missing models resolve to `None` via `lookup_price`.
}


# Maps each init_chat_model provider id to its `[project.optional-dependencies]`
# extra in `pyproject.toml` (note the underscored ids google_genai / mistralai map
# to the short extra names google / mistral). Every extra here is bundled into
# `langgraph-all`, which the container agent layer preinstalls
# (`uv sync --extra langgraph-all`), so provider selection is config-only with no
# in-container install step. `install_hint` surfaces should-never-fire remediation
# through `ProviderPackageMissing`. Ollama is omitted - `langchain-ollama` is a core
# dependency, so its package is never missing.
PROVIDER_EXTRAS: dict[str, str] = {
    "anthropic": "anthropic",
    "openai": "openai",
    "google_genai": "google",
    "groq": "groq",
    "mistralai": "mistral",
    "bedrock": "bedrock",
    "cohere": "cohere",
    "fireworks": "fireworks",
    "together": "together",
    "deepseek": "deepseek",
    "xai": "xai",
    "perplexity": "perplexity",
    "nvidia": "nvidia",
    "huggingface": "huggingface",
}


def install_hint(provider: str) -> str:
    """Return should-never-fire remediation for a missing provider package.

    All curated providers ship preinstalled in the agent image via the
    `langgraph-all` extra, so this only surfaces if a running image predates the
    provider - the remediation is an image rebuild. Unknown providers get the
    bare `langchain-<provider>` package name (underscores translated to hyphens,
    LangChain's package-naming convention) to add to `langgraph-all` first.
    """

    if provider in PROVIDER_EXTRAS:
        return (
            f"provider {provider!r} ships preinstalled via the 'langgraph-all' extra; "
            "rebuild the agent image if it is missing: claudebox build --layer agent"
        )

    package = f"langchain-{provider.replace('_', '-')}"

    return (
        f"unknown provider {provider!r}; add {package} to the 'langgraph-all' extra in "
        "pyproject.toml, then rebuild the agent image: claudebox build --layer agent"
    )


def lookup_context_window(spec: ProviderSpec, override: int | None) -> int:
    """Return the per-model context-window in tokens.

    Workspace `[langgraph] max_tokens_override = N` short-circuits the table
    lookup so users running a model outside `MODEL_CONTEXT_WINDOW` can pin
    the right ceiling without code changes. Unknown models fall back to
    `MODEL_CONTEXT_WINDOW["default"]`. Lookup uses `spec.model_id` - the
    prefix-strip happened at parse time, never at lookup time.
    """

    if override is not None:
        return override

    return MODEL_CONTEXT_WINDOW.get(spec.model_id, MODEL_CONTEXT_WINDOW["default"])


def lookup_price(
    spec: ProviderSpec, overrides: dict[str, dict[str, float]]
) -> dict[str, float] | None:
    """Return the per-million-token USD rates for a model, or `None` if unknown.

    Workspace `[langgraph.cost]` overrides take precedence over the curated
    `PRICE_PER_MTOK` table so users can pin USD for models the curated
    table doesn't carry. Lookup uses `spec.model_id`. Unknown models with
    no override resolve to `None`; callers (`_accumulate_usage`) translate
    that to a `None` per-turn cost so the projection skips the update and
    the frontend hides the cost row.
    """

    return overrides.get(spec.model_id) or PRICE_PER_MTOK.get(spec.model_id)


def _probe_ollama(spec: ProviderSpec) -> None:
    """Probe Ollama /api/version + /api/show in one connect-time pass.

    Runs reachability (GET /api/version) then model-pulled (POST /api/show)
    checks against the configured `base_url`. No-op when `base_url` is
    absent: init_chat_model uses its own default in that case and any
    failure surfaces at first query().

    Raises:
        OllamaUnreachable: /api/version fails or /api/show returns 5xx /
            connect / timeout.
        OllamaModelNotPulled: /api/show returns 404.
    """

    base_url = spec.kwargs.get("base_url")

    if not base_url:
        return

    url = str(base_url)

    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{url.rstrip('/')}/api/version")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OllamaUnreachable(url) from exc

    try:
        with httpx.Client(timeout=2.0) as client:
            response = client.post(f"{url.rstrip('/')}/api/show", json={"name": spec.model_id})
    except httpx.HTTPError as exc:
        raise OllamaUnreachable(url) from exc

    if response.status_code == 404:
        raise OllamaModelNotPulled(spec.model_id)

    try:
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OllamaUnreachable(url) from exc


def _probe_openai_compatible(spec: ProviderSpec) -> None:
    """Probe OpenAI-compatible /v1/models endpoint.

    Opt-in via `spec.kwargs.get("probe_on_connect", False)` because local
    OpenAI-compatible servers (vLLM, LM Studio, llama.cpp) may not be up
    at session-create time. When `base_url` is absent OR `probe_on_connect`
    is false, the probe is a no-op (errors surface at first query()).

    Raises:
        OpenAICompatibleUnreachable: /v1/models GET fails (carries the
            base_url specifically - distinct from OllamaUnreachable so
            users debugging a vLLM / LM Studio / llama.cpp server see the
            right diagnostic context).
    """

    base_url = spec.kwargs.get("base_url")

    if not base_url:
        return

    if not spec.kwargs.get("probe_on_connect", False):
        return

    url = str(base_url)

    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{url.rstrip('/')}/v1/models")
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise OpenAICompatibleUnreachable(url) from exc


def _fetch_ollama_catalog(spec: ProviderSpec) -> list[Model]:
    """Fetch the Ollama tag catalog via /api/tags.

    Degrades to `[]` when `base_url` is absent or the endpoint errors. The
    connect-time probe (`_probe_ollama`) already raises typed exceptions
    for the session-create path, so this catalog call only fails-silently
    when invoked post-connect against a transiently-down server (the UI
    asking for a fresh picker).
    """

    base_url = spec.kwargs.get("base_url")

    if not base_url:
        return []

    url = str(base_url)

    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{url.rstrip('/')}/api/tags")
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    models: list[Model] = []

    for tag in data.get("models") or []:
        tag_name = tag.get("name") or tag.get("model")

        if not tag_name:
            continue

        models.append(
            Model(
                id=tag_name,
                name=tag_name,
                context_window=MODEL_CONTEXT_WINDOW.get(tag_name, MODEL_CONTEXT_WINDOW["default"]),
            )
        )

    return models


def _fetch_openai_catalog(spec: ProviderSpec) -> list[Model]:
    """Fetch the OpenAI-compatible model catalog via /v1/models.

    Degrades to `[]` when `base_url` is absent or the endpoint errors -
    cloud OpenAI deployments use the default openai.com base_url which
    requires an API key for /v1/models; the UI degrades gracefully and the
    workspace TOML's `[langgraph] model = "..."` is the authoritative
    source of the active model id.
    """

    base_url = spec.kwargs.get("base_url")

    if not base_url:
        return []

    url = str(base_url)

    try:
        with httpx.Client(timeout=3.0) as client:
            response = client.get(f"{url.rstrip('/')}/v1/models")
            response.raise_for_status()
            data = response.json()
    except (httpx.HTTPError, ValueError):
        return []

    models: list[Model] = []

    for entry in data.get("data") or []:
        model_id = entry.get("id")

        if not model_id:
            continue

        models.append(
            Model(
                id=model_id,
                name=model_id,
                context_window=MODEL_CONTEXT_WINDOW.get(model_id, MODEL_CONTEXT_WINDOW["default"]),
            )
        )

    return models


# Cloud providers (anthropic, google_genai, groq, mistralai, ...) have no
# entry; DEFAULT_STRATEGY (no probe, no catalog) applies via `.get()`
# fallback at the dispatch sites in runtime_langgraph.connect() and
# runtime_langgraph.get_models().
PROVIDER_STRATEGIES: dict[str, ProviderStrategy] = {
    "ollama": ProviderStrategy(probe=_probe_ollama, fetch_catalog=_fetch_ollama_catalog),
    "openai": ProviderStrategy(
        probe=_probe_openai_compatible,
        fetch_catalog=_fetch_openai_catalog,
    ),
}


DEFAULT_STRATEGY = ProviderStrategy()
