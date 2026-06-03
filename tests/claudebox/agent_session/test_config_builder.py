"""Tests for ClaudeRuntime._build_sdk_options — config → SDK options round-trip."""

from pathlib import Path

from claudebox.agent_session.config import ClaudeAgentSessionConfig, RuntimeCapabilities
from claudebox.agent_session.hooks import HookCallbacks
from claudebox.agent_session.runtime_claude import ClaudeRuntime


def _config(**overrides) -> ClaudeAgentSessionConfig:
    """Build a ClaudeAgentSessionConfig for round-trip tests; overrides spread on top."""

    defaults: dict = {
        "runtime": "claude",
        "model": "claude-opus-4-8",
        "permission_mode": "default",
        "effort_level": "xhigh",
        "cwd": "/workspace",
        "env": {"FOO": "bar"},
        "session_id": "abc-123",
        "resume_session_id": None,
        "session_dir": Path("/tmp/sessions/abc-123"),
        "hooks": HookCallbacks(),
        "system_prompt": "do the thing",
    }
    defaults.update(overrides)
    return ClaudeAgentSessionConfig(**defaults)


# _build_sdk_options
# --------------------------------------------------------------------------------------------------


class TestBuildSdkOptions:
    """ClaudeRuntime._build_sdk_options round-trips field-for-field."""

    def test_passes_through_universal_fields(self):
        """system_prompt, permission_mode, env, cwd, max_buffer_size reach the options."""

        opts = ClaudeRuntime._build_sdk_options(_config(max_buffer_size=42))

        assert opts.system_prompt == "do the thing"
        assert opts.permission_mode == "default"
        assert opts.env == {"FOO": "bar"}
        assert opts.cwd == "/workspace"
        assert opts.max_buffer_size == 42

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
            _config(session_id="abc-123", resume_session_id=None)
        )
        assert opts.extra_args.get("session-id") == "abc-123"
        assert "resume" not in opts.extra_args

    def test_extra_args_resume_when_set(self):
        """resume takes precedence; session-id not set."""

        opts = ClaudeRuntime._build_sdk_options(
            _config(session_id="abc-123", resume_session_id="def-456")
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


# capabilities + runtime_name (concrete on ClaudeRuntime)
# --------------------------------------------------------------------------------------------------


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
        """Decision 19: catalog flags do NOT carry _catalog suffix."""

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
