/** Test helper - produces a RuntimeCapabilities object with overrides. */

/**
 * Build a 15-flag RuntimeCapabilities dict, all true by default; pass `overrides` to flip flags
 * false for capability-gated UI tests. Shape mirrors the backend `RuntimeCapabilities` dataclass.
 */
export function mockCapabilities(overrides = {}) {
  return {
    supports_set_model_mid_session: true,
    supports_set_permission_mode: true,
    supports_set_effort_level: true,
    supports_pre_compact_hook: true,
    supports_mcp_delegation: true,
    supports_models: true,
    supports_effort_levels: true,
    supports_permission_modes: true,
    supports_skills: true,
    supports_context_usage: true,
    supports_cost_telemetry: true,
    supports_manual_compact: true,
    supports_session_fork: true,
    supports_session_rewind: true,
    supports_ask_user_question: true,
    ...overrides,
  }
}
