"""AgentSession - Protocol every runtime adapter satisfies."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Protocol, runtime_checkable

from .catalogs import ContextUsage, EffortLevel, Model, PermissionMode, Skill, StreamHealth
from .config import RuntimeCapabilities
from .events import AgentEvent


@runtime_checkable
class AgentSession(Protocol):
    """Runtime-neutral interface implemented by every adapter."""

    runtime_name: str

    CAPABILITIES: RuntimeCapabilities

    ready: asyncio.Event

    @property
    def capabilities(self) -> RuntimeCapabilities: ...

    async def connect(self) -> None: ...

    async def disconnect(self) -> None: ...

    async def query(self, prompt: str | list[dict]) -> None: ...

    async def interrupt(self) -> None: ...

    async def set_model(self, model: str | None = None) -> None: ...

    async def set_permission_mode(self, mode: str) -> None: ...

    async def set_effort_level(self, level: str) -> None: ...

    async def reconnect_mcp_server(self, server_name: str) -> None: ...

    async def toggle_mcp_server(self, server_name: str, enabled: bool) -> None: ...

    async def get_mcp_status(self) -> dict: ...

    async def get_context_usage(self) -> ContextUsage | None: ...

    def stream_health(self) -> StreamHealth | None: ...

    def receive_events(self) -> AsyncIterator[AgentEvent]: ...

    def get_models(self) -> list[Model]: ...

    def get_effort_levels(self) -> list[EffortLevel]: ...

    def get_permission_modes(self) -> list[PermissionMode]: ...

    @classmethod
    def get_default_model(cls) -> str: ...

    @classmethod
    def get_default_effort_level(cls) -> str: ...

    @classmethod
    def get_default_permission_mode(cls) -> str: ...

    @classmethod
    def get_skills(
        cls,
        commands_dir: Path | None = None,
        skills_dir: Path | None = None,
    ) -> list[Skill]: ...
