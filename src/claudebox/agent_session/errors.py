"""Typed exception hierarchy for agent-session runtime adapters."""


class UnknownRuntime(Exception):
    """Raised when AgentSessionConfig.runtime names an unregistered runtime."""


class ProviderError(Exception):
    """Base for typed provider-layer failures.

    Container-API handlers map any `isinstance(exc, ProviderError)` to a typed HTTP response;
    concrete subclasses populate the diagnostic context.
    """


class ProviderPackageMissing(ProviderError):
    """init_chat_model raised ImportError - provider package not installed.

    Carries the provider name and a `pip install ...` hint that the handler surfaces in the HTTP
    422 body, so the user sees the exact remediation command.
    """

    def __init__(self, provider: str, install_hint: str) -> None:
        super().__init__(f"Provider {provider!r} package missing - {install_hint}")
        self.provider = provider
        self.install_hint = install_hint


class OllamaUnreachable(ProviderError):
    """Ollama API did not respond at the configured base_url."""

    def __init__(self, url: str) -> None:
        super().__init__(f"Ollama unreachable at {url}")
        self.url = url


class OllamaModelNotPulled(ProviderError):
    """Configured model is not present on the Ollama instance."""

    def __init__(self, model: str) -> None:
        super().__init__(f"Model {model!r} not pulled on the configured Ollama instance")
        self.model = model


class OpenAICompatibleUnreachable(ProviderError):
    """OpenAI-compatible /v1/models probe failed at the configured base_url.

    Distinct from `OllamaUnreachable` so the diagnostic message names the right backend (vLLM, LM
    Studio, llama.cpp, etc.) instead of Ollama, giving users the right debugging context.
    """

    def __init__(self, url: str) -> None:
        super().__init__(f"OpenAI-compatible API unreachable at {url}")
        self.url = url
