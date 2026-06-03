"""make_agent_session factory + UnknownRuntime dispatch."""

from pathlib import Path

import pytest

from claudebox.agent_session.config import AgentSessionConfig, ClaudeAgentSessionConfig
from claudebox.agent_session.errors import UnknownRuntime
from claudebox.agent_session.protocol import AgentSession
from claudebox.agent_session.runtime_claude import ClaudeRuntime
from claudebox.agent_session.session import make_agent_session


def _claude_config(tmp_path: Path) -> ClaudeAgentSessionConfig:
    return ClaudeAgentSessionConfig(
        runtime="claude",
        model=None,
        permission_mode=None,
        effort_level=None,
        cwd=str(tmp_path),
        env={},
        session_id="sess-1",
        resume_session_id=None,
        session_dir=tmp_path,
    )


class TestMakeAgentSession:
    """Factory dispatches on config.runtime and validates the config subclass."""

    def test_claude_runtime_returns_claude_runtime_instance(self, tmp_path):
        runtime = make_agent_session(_claude_config(tmp_path))

        assert isinstance(runtime, ClaudeRuntime)

    def test_factory_result_satisfies_agent_session_protocol(self, tmp_path):
        runtime = make_agent_session(_claude_config(tmp_path))

        assert isinstance(runtime, AgentSession)

    def test_unknown_runtime_raises(self, tmp_path):
        config = AgentSessionConfig(
            runtime="bogus",  # ty: ignore[invalid-argument-type]  # Literal narrowing bypassed for defensive test.
            model=None,
            permission_mode=None,
            effort_level=None,
            cwd=str(tmp_path),
            env={},
            session_id=None,
            resume_session_id=None,
            session_dir=tmp_path,
        )

        with pytest.raises(UnknownRuntime, match="bogus"):
            make_agent_session(config)
