"""Tests for ClaudeRuntime._build_sdk_options - config -> SDK options round-trip."""

from __future__ import annotations

import importlib.util
import mmap
from pathlib import Path

from claudebox.agent_session.config import ClaudeAgentSessionConfig, RuntimeCapabilities
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_claude import ClaudeRuntime


def _config(**overrides) -> ClaudeAgentSessionConfig:
    """Build a ClaudeAgentSessionConfig for round-trip tests; overrides spread on top."""

    defaults: dict = {
        "runtime": "claude",
        "model": "claude-opus-5",
        "permission_mode": "default",
        "effort_level": "xhigh",
        "cwd": "/workspace",
        "env": {"FOO": "bar"},
        "session_id": "abc-123",
        "resume_session_id": None,
        "session_dir": Path("/tmp/sessions/abc-123"),
        "hooks": HookCallbacks(),
        "system_prompt_file": Path("/run/claudebox/prompt.md"),
    }
    defaults.update(overrides)

    return ClaudeAgentSessionConfig(**defaults)


class TestBuildSdkOptions:
    """ClaudeRuntime._build_sdk_options round-trips field-for-field."""

    def test_passes_through_universal_fields(self):
        """system_prompt_file, permission_mode, cwd, max_buffer_size reach the options."""

        opts = ClaudeRuntime._build_sdk_options(_config(max_buffer_size=42))

        assert opts.system_prompt == {"type": "file", "path": "/run/claudebox/prompt.md"}
        assert opts.permission_mode == "default"
        assert opts.cwd == "/workspace"
        assert opts.max_buffer_size == 42

    def test_env_lets_a_turn_end_on_needs_user(self):
        """The CLI gets the session's environment plus needs_user as a tool a turn may end on."""

        opts = ClaudeRuntime._build_sdk_options(_config())

        assert opts.env == {
            "FOO": "bar",
            "CLAUDE_CODE_TERMINAL_MCP_TOOLS": "mcp__claudebox__needs_user",
        }

    def test_bundled_cli_still_reads_the_terminal_tools_variable(self):
        """The agent CLI the SDK bundles carries the undocumented variable the options set."""

        spec = importlib.util.find_spec("claude_agent_sdk")
        assert spec is not None and spec.submodule_search_locations is not None
        cli = Path(spec.submodule_search_locations[0]) / "_bundled" / "claude"

        with cli.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as image:
            assert image.find(b"CLAUDE_CODE_TERMINAL_MCP_TOOLS") != -1

    def test_no_prompt_file_passes_no_system_prompt(self):
        """A profile without a prompt leaves the SDK's system prompt unset."""

        opts = ClaudeRuntime._build_sdk_options(_config(system_prompt_file=None))
        assert opts.system_prompt is None

    def test_setting_sources_default_user_project(self):
        """Default setting_sources is ['user', 'project']."""

        opts = ClaudeRuntime._build_sdk_options(_config())
        assert opts.setting_sources == ["user", "project"]

    def test_extra_args_replay_user_messages(self):
        """replay-user-messages is always set in extra_args."""

        opts = ClaudeRuntime._build_sdk_options(_config())
        assert "replay-user-messages" in opts.extra_args
        assert opts.extra_args["replay-user-messages"] is None

    def test_extra_args_session_id_when_no_resume(self):
        """session-id is set when resume_session_id is None."""

        opts = ClaudeRuntime._build_sdk_options(
            _config(session_id="abc-123", resume_session_id=None),
        )
        assert opts.extra_args.get("session-id") == "abc-123"
        assert "resume" not in opts.extra_args

    def test_extra_args_resume_when_set(self):
        """resume takes precedence; session-id not set."""

        opts = ClaudeRuntime._build_sdk_options(
            _config(session_id="abc-123", resume_session_id="def-456"),
        )
        assert opts.extra_args.get("resume") == "def-456"
        assert "session-id" not in opts.extra_args

    def test_extra_args_debug_to_stderr_when_debug_mode(self):
        """debug-to-stderr is set when debug_mode is True."""

        opts = ClaudeRuntime._build_sdk_options(_config(debug_mode=True))
        assert "debug-to-stderr" in opts.extra_args

    def test_extra_args_no_debug_when_debug_mode_false(self):
        """debug-to-stderr is absent when debug_mode is False (default)."""

        opts = ClaudeRuntime._build_sdk_options(_config(debug_mode=False))
        assert "debug-to-stderr" not in opts.extra_args

    def test_sdk_passthrough_merges_into_extra_args(self):
        """sdk_passthrough values overlay extra_args."""

        opts = ClaudeRuntime._build_sdk_options(_config(sdk_passthrough={"custom-flag": "x"}))
        assert opts.extra_args.get("custom-flag") == "x"


class TestCapabilitiesAndRuntimeName:
    """ClaudeRuntime exposes its capability matrix and runtime_name."""

    def test_runtime_name_class_attribute(self):
        """runtime_name is 'Claude' at class level."""

        assert ClaudeRuntime.runtime_name == "Claude"

    def test_capabilities_returns_dataclass_with_all_true(self):
        """All 16 RuntimeCapabilities flags are True under ClaudeRuntime."""

        from unittest.mock import patch

        with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient"):
            runtime = ClaudeRuntime(_config())

        caps = runtime.capabilities
        assert isinstance(caps, RuntimeCapabilities)

        for field_name in RuntimeCapabilities.__dataclass_fields__:
            assert getattr(caps, field_name) is True, f"{field_name} should be True"

    def test_capability_field_names_drop_catalog_suffix(self):
        """Capability field names omit the _catalog suffix."""

        expected_no_catalog = {
            "supports_models",
            "supports_effort_levels",
            "supports_permission_modes",
            "supports_skills",
        }
        assert expected_no_catalog.issubset(RuntimeCapabilities.__dataclass_fields__.keys())

        forbidden = {
            "supports_models_catalog",
            "supports_effort_levels_catalog",
            "supports_permission_modes_catalog",
            "supports_skills_catalog",
        }
        assert forbidden.isdisjoint(RuntimeCapabilities.__dataclass_fields__.keys())
