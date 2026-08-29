/** Numeric thresholds - size limits, buffer caps. */

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const MAX_LOGS = 1000
export const MAX_MERMAID_CACHE_ENTRIES = 50
export const MAX_INPUT_HISTORY_ENTRIES = 200
export const MAX_INPUT_HISTORY_BYTES = 256 * 1024 // 256 KB, oldest entries evicted first

// Events materialized per drain slice on resume; bounds each commit so the browser keeps a paint/input window.
// Also bounds how many turns cross the transcript's unwindowed active-turn slot - turns landing
// inside one slice go straight to the windowed list, so a larger slice mounts fewer of them.
export const REPLAY_DRAIN_SLICE_SIZE = 500

// Staleness fade past STALENESS_STALE_PEAK_MS: fraction = 1 - 1 / (1 + STALENESS_FADE_RATE * overflow_ms).
export const STALENESS_FADE_RATE = 0.00002

// Footer plan-limit item color ramp: amber at the warning start, red from here up, clamped beyond.
export const RATE_LIMIT_WARNING_START_PCT = 75
export const RATE_LIMIT_DANGER_PCT = 95
