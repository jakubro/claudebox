/** Numeric thresholds — size limits, buffer caps. */

export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
export const MAX_LOGS = 1000

// Decay rate for staleness color fade past STALENESS_STALE_PEAK_MS:
// fade fraction = 1 - 1 / (1 + STALENESS_FADE_RATE * overflow_ms).
export const STALENESS_FADE_RATE = 0.00002
