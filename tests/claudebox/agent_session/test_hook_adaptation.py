"""Hook adaptation + delta-detection tests for ClaudeRuntime.

Covers two concerns:

1. SDK hook adapters — `_adapt_session_start` / `_adapt_pre_compact` /
   `_adapt_post_tool_use` — translate SDK HookInput shapes into the
   typed HookCallbacks surface.

2. Delta detection — `_fire_*_changed` helpers + setter wiring. First
   call after construction silently establishes the baseline; only
   subsequent actual changes fire the callback. PostToolUse-as-detector
   converges on `_fire_permission_mode_changed` so setter-driven and
   SDK-detected changes share one delta filter.
"""

from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from claudebox.agent_session.config import ClaudeAgentSessionConfig
from claudebox.agent_session.hooks import CompactStartPayload, HookCallbacks
from claudebox.agent_session.runtime_claude import ClaudeRuntime


def _make_runtime(callbacks: HookCallbacks | None = None) -> ClaudeRuntime:
    """Build a ClaudeRuntime with mocked SDK + the given callbacks."""

    from unittest.mock import patch

    config = ClaudeAgentSessionConfig(
        runtime="claude",
        model=None,
        permission_mode=None,
        effort_level=None,
        cwd="/tmp",
        env={},
        session_id=None,
        resume_session_id=None,
        session_dir=Path("/tmp"),
        hooks=callbacks or HookCallbacks(),
    )
    with patch("claudebox.agent_session.runtime_claude.BaseClaudeSDKClient"):
        return ClaudeRuntime(config)


# Adapter: _adapt_pre_compact (trigger translation)
# --------------------------------------------------------------------------------------------------


class TestAdaptPreCompact:
    """PreCompact adapter translates SDK auto/manual into context_limit/manual."""

    @pytest.mark.anyio
    async def test_translates_auto_to_context_limit(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_pre_compact=cb))

        await runtime._adapt_pre_compact({"trigger": "auto"}, None, {})

        cb.assert_awaited_once_with(CompactStartPayload(trigger="context_limit"))

    @pytest.mark.anyio
    async def test_passes_manual_through(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_pre_compact=cb))

        await runtime._adapt_pre_compact({"trigger": "manual"}, None, {})

        cb.assert_awaited_once_with(CompactStartPayload(trigger="manual"))

    @pytest.mark.anyio
    async def test_unknown_trigger_defaults_to_manual(self):
        """Unknown SDK trigger values fall back to manual — narrow union enforces typed payload."""

        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_pre_compact=cb))

        await runtime._adapt_pre_compact({"trigger": "future_value"}, None, {})

        cb.assert_awaited_once_with(CompactStartPayload(trigger="manual"))

    @pytest.mark.anyio
    async def test_non_dict_input_defaults_to_manual(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_pre_compact=cb))

        await runtime._adapt_pre_compact("not-a-dict", None, {})

        cb.assert_awaited_once_with(CompactStartPayload(trigger="manual"))

    @pytest.mark.anyio
    async def test_no_callback_registered(self):
        runtime = _make_runtime(HookCallbacks(on_pre_compact=None))
        # Should not raise
        result = await runtime._adapt_pre_compact({"trigger": "auto"}, None, {})
        assert result == {}


# Adapter: _adapt_session_start
# --------------------------------------------------------------------------------------------------


class TestAdaptSessionStart:
    """SessionStart adapter calls the no-arg callback."""

    @pytest.mark.anyio
    async def test_invokes_callback(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_session_start=cb))

        await runtime._adapt_session_start({}, None, {})

        cb.assert_awaited_once_with()

    @pytest.mark.anyio
    async def test_no_callback_registered(self):
        runtime = _make_runtime(HookCallbacks(on_session_start=None))
        result = await runtime._adapt_session_start({}, None, {})
        assert result == {}


# Delta detection: set_model + _fire_model_changed
# --------------------------------------------------------------------------------------------------


class TestModelDeltaDetection:
    """set_model + _fire_model_changed delta detection with baseline-on-first-call."""

    @pytest.mark.anyio
    async def test_first_call_silently_establishes_baseline(self):
        """First set_model after construction: callback NOT called; baseline set."""

        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_model_changed=cb))
        runtime.ready.set()  # bypass buffering for setter

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_model", AsyncMock())
            await runtime.set_model("claude-opus-4-7")

        cb.assert_not_awaited()
        assert runtime._last_known_model == "claude-opus-4-7"

    @pytest.mark.anyio
    async def test_second_call_with_different_value_fires(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_model_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_model", AsyncMock())
            await runtime.set_model("claude-opus-4-7")
            await runtime.set_model("claude-haiku-4-5")

        cb.assert_awaited_once_with("claude-haiku-4-5")
        assert runtime._last_known_model == "claude-haiku-4-5"

    @pytest.mark.anyio
    async def test_same_value_no_fire(self):
        """Setter with same value: no callback even with baseline established."""

        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_model_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_model", AsyncMock())
            await runtime.set_model("claude-opus-4-7")  # baseline
            await runtime.set_model("claude-opus-4-7")  # no-op

        cb.assert_not_awaited()

    @pytest.mark.anyio
    async def test_no_callback_registered_still_tracks_baseline(self):
        runtime = _make_runtime(HookCallbacks(on_model_changed=None))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_model", AsyncMock())
            await runtime.set_model("claude-opus-4-7")

        assert runtime._last_known_model == "claude-opus-4-7"


# Delta detection: set_permission_mode + _fire_permission_mode_changed
# --------------------------------------------------------------------------------------------------


class TestPermissionModeDeltaDetection:
    """Symmetric to model delta detection — same baseline + fire semantics."""

    @pytest.mark.anyio
    async def test_first_call_silently_establishes_baseline(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_permission_mode_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_permission_mode", AsyncMock())
            await runtime.set_permission_mode("default")

        cb.assert_not_awaited()
        assert runtime._last_known_permission_mode == "default"

    @pytest.mark.anyio
    async def test_second_call_with_different_value_fires(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_permission_mode_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_permission_mode", AsyncMock())
            await runtime.set_permission_mode("default")
            await runtime.set_permission_mode("plan")

        cb.assert_awaited_once_with("plan")


# Delta detection: set_effort_level + _fire_effort_level_changed
# --------------------------------------------------------------------------------------------------


class TestEffortLevelDeltaDetection:
    """Symmetric to model + permission_mode delta detection."""

    @pytest.mark.anyio
    async def test_first_call_silently_establishes_baseline(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_effort_level_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(ClaudeRuntime, "_write_effort_to_settings", lambda cls, level: None)
            await runtime.set_effort_level("xhigh")

        cb.assert_not_awaited()
        assert runtime._last_known_effort_level == "xhigh"

    @pytest.mark.anyio
    async def test_second_call_with_different_value_fires(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_effort_level_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(ClaudeRuntime, "_write_effort_to_settings", lambda cls, level: None)
            await runtime.set_effort_level("xhigh")
            await runtime.set_effort_level("low")

        cb.assert_awaited_once_with("low")


# PostToolUse permission-mode-detector convergence
# --------------------------------------------------------------------------------------------------


class TestPostToolUseConvergence:
    """SDK-detected mode drift via PostToolUse converges on _fire_permission_mode_changed."""

    @pytest.mark.anyio
    async def test_post_tool_use_routes_to_fire_permission_mode_changed(self):
        """PostToolUse adapter with mode reaches the same delta filter as set_permission_mode."""

        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_permission_mode_changed=cb))

        # First PostToolUse establishes baseline silently — no callback.
        await runtime._adapt_post_tool_use({"permission_mode": "default"}, None, {})
        cb.assert_not_awaited()

        # Second PostToolUse with different mode fires callback.
        await runtime._adapt_post_tool_use({"permission_mode": "plan"}, None, {})
        cb.assert_awaited_once_with("plan")

    @pytest.mark.anyio
    async def test_setter_and_post_tool_use_share_baseline(self):
        """Baseline established by setter is respected by PostToolUse and vice versa."""

        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_permission_mode_changed=cb))
        runtime.ready.set()

        with pytest.MonkeyPatch().context() as mp:
            mp.setattr(runtime._sdk, "set_permission_mode", AsyncMock())
            # Setter establishes baseline (no callback).
            await runtime.set_permission_mode("default")
        cb.assert_not_awaited()

        # PostToolUse with same value — still no callback (delta filter).
        await runtime._adapt_post_tool_use({"permission_mode": "default"}, None, {})
        cb.assert_not_awaited()

        # PostToolUse with different value — callback fires once.
        await runtime._adapt_post_tool_use({"permission_mode": "plan"}, None, {})
        cb.assert_awaited_once_with("plan")

    @pytest.mark.anyio
    async def test_post_tool_use_no_mode_field_ignored(self):
        cb = AsyncMock()
        runtime = _make_runtime(HookCallbacks(on_permission_mode_changed=cb))

        await runtime._adapt_post_tool_use({}, None, {})  # no permission_mode key
        await runtime._adapt_post_tool_use("not-a-dict", None, {})

        cb.assert_not_awaited()
        assert runtime._last_known_permission_mode is None  # baseline not established


# _build_sdk_hooks
# --------------------------------------------------------------------------------------------------


class TestBuildSdkHooks:
    """Builds the SDK hooks dict shape from typed HookCallbacks."""

    def test_no_callbacks_empty_dict(self):
        runtime = _make_runtime(HookCallbacks())
        hooks = ClaudeRuntime._build_sdk_hooks(runtime)
        # No callbacks registered → no hooks wired.
        assert hooks == {}

    def test_pre_compact_only(self):
        async def cb(_p):
            pass

        runtime = _make_runtime(HookCallbacks(on_pre_compact=cb))
        hooks = ClaudeRuntime._build_sdk_hooks(runtime)
        assert set(hooks) == {"PreCompact"}

    def test_permission_mode_changed_wires_post_tool_use_and_session_start(self):
        """on_permission_mode_changed registers both PostToolUse and SessionStart adapters
        (the latter silently establishes the baseline before any tool runs)."""

        async def cb(_m):
            pass

        runtime = _make_runtime(HookCallbacks(on_permission_mode_changed=cb))
        hooks = ClaudeRuntime._build_sdk_hooks(runtime)
        assert "PostToolUse" in hooks
        assert "SessionStart" in hooks

    def test_session_start_and_permission_mode_both_wire_dual_session_start(self):
        """SessionStart hook list carries both adapters when both callbacks registered."""

        async def cb_start():
            pass

        async def cb_mode(_m):
            pass

        runtime = _make_runtime(
            HookCallbacks(on_session_start=cb_start, on_permission_mode_changed=cb_mode)
        )
        hooks = ClaudeRuntime._build_sdk_hooks(runtime)
        session_start = hooks["SessionStart"][0]
        assert len(session_start.hooks) == 2  # both adapters wired
