/** Color interpolation and derived color utilities. */

import { STALENESS_FADE_RATE } from '../config/thresholds'
import { STALENESS_FRESH_PEAK_MS, STALENESS_STALE_PEAK_MS } from '../config/timing'

const FAVICON_BG_LIGHTNESS = 0.36
const FAVICON_BG_SATURATION_BOOST = 1.5

// Staleness gradient anchors
const COLOR_FRESH = '#3b82f6' // blue — active
const COLOR_WARM = '#a855f7' // purple — waypoint to avoid gray zone in RGB space
const COLOR_STALE = '#f59e0b' // amber — going quiet
const COLOR_FADED = '#4b5563' // gray — dormant

/** Parse hex color (#rrggbb) to [r, g, b]. */
export function hexToRgb(hex) {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
}

/** Convert [r, g, b] to hex color string. */
export function rgbToHex(r, g, b) {
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

/** Convert [r, g, b] (0-255) to HSL — h in degrees [0,360), s and l in [0,1]. */
export function rgbToHsl(r, g, b) {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) {
    return [0, 0, l]
  }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === rn) {
    h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60
  } else if (max === gn) {
    h = ((bn - rn) / d + 2) * 60
  } else {
    h = ((rn - gn) / d + 4) * 60
  }
  return [h, s, l]
}

/** Convert HSL (h in degrees, s and l in [0,1]) to [r, g, b] (0-255). */
export function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hPrime = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hPrime % 2) - 1))
  const m = l - c / 2
  let rn
  let gn
  let bn
  if (hPrime < 1) {
    ;[rn, gn, bn] = [c, x, 0]
  } else if (hPrime < 2) {
    ;[rn, gn, bn] = [x, c, 0]
  } else if (hPrime < 3) {
    ;[rn, gn, bn] = [0, c, x]
  } else if (hPrime < 4) {
    ;[rn, gn, bn] = [0, x, c]
  } else if (hPrime < 5) {
    ;[rn, gn, bn] = [x, 0, c]
  } else {
    ;[rn, gn, bn] = [c, 0, x]
  }
  return [Math.round((rn + m) * 255), Math.round((gn + m) * 255), Math.round((bn + m) * 255)]
}

/**
 * Derive a lighter hover color from a hex accent by boosting each channel.
 *
 * Adds a fixed offset to each RGB channel for a subtle brightening effect.
 * Clamps at 255 to stay within valid color range.
 */
export function deriveHoverColor(hex) {
  const r = Math.min(255, Number.parseInt(hex.slice(1, 3), 16) + 30)
  const g = Math.min(255, Number.parseInt(hex.slice(3, 5), 16) + 30)
  const b = Math.min(255, Number.parseInt(hex.slice(5, 7), 16) + 30)
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * Derive a favicon-bg color from a workspace accent: brighten in HSL space.
 *
 * Preserves hue, sets lightness to a fixed target, and amplifies saturation
 * so the workspace identity reads at favicon scale where the muted source
 * loses its hue. Example: `#2a4a2a` (dark green) → `#368236` (saturated
 * green at moderate lightness).
 *
 * The picker palette and tab-bar gradient consume the raw accent. The
 * favicon caller is the only consumer of this brightener.
 */
export function deriveFaviconBgColor(hex) {
  const [r, g, b] = hexToRgb(hex)
  const [h, s] = rgbToHsl(r, g, b)
  const boostedS = Math.min(1, s * FAVICON_BG_SATURATION_BOOST)
  const [nr, ng, nb] = hslToRgb(h, boostedS, FAVICON_BG_LIGHTNESS)
  return rgbToHex(nr, ng, nb)
}

/** Linearly interpolate between two hex colors. */
export function lerpColor(a, b, t) {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const clamp = Math.max(0, Math.min(1, t))
  return rgbToHex(
    Math.round(ar + (br - ar) * clamp),
    Math.round(ag + (bg - ag) * clamp),
    Math.round(ab + (bb - ab) * clamp),
  )
}

/**
 * Calculate context bar color using exponential curve.
 * Blue for most values, shifts quickly to yellow near 90%, orange near 100%.
 */
export function getContextBarColor(percent) {
  // Exponential curve with power of 8: stays blue until ~85%, then shifts quickly
  const t = Math.min(1, percent / 100)
  const intensity = t ** 8

  // HSL interpolation: blue (210) -> yellow (50) -> orange (25)
  let hue
  if (intensity < 0.5) {
    hue = 210 - intensity * 2 * 160 // 210 -> 50
  } else {
    hue = 50 - (intensity - 0.5) * 2 * 25 // 50 -> 25
  }

  return `hsl(${hue}, 80%, 55%)`
}

/**
 * Compute border color for a running task based on staleness.
 *
 * Gradient: blue (≤15s) → purple → amber (90s) → fading toward gray (90s+).
 * Routes through purple waypoint to follow warm hue path (avoids gray zone
 * that RGB lerp produces between complementary blue and amber).
 */
export function getStalenessColor(stalenessMs) {
  if (stalenessMs <= STALENESS_FRESH_PEAK_MS) {
    return COLOR_FRESH
  }
  if (stalenessMs <= STALENESS_STALE_PEAK_MS) {
    const t =
      (stalenessMs - STALENESS_FRESH_PEAK_MS) / (STALENESS_STALE_PEAK_MS - STALENESS_FRESH_PEAK_MS)
    // Two-segment lerp through warm waypoint: blue → purple → amber
    if (t <= 0.5) {
      return lerpColor(COLOR_FRESH, COLOR_WARM, t * 2)
    }
    return lerpColor(COLOR_WARM, COLOR_STALE, (t - 0.5) * 2)
  }
  // Beyond stale peak: fade toward gray with inverse decay
  const overflow = stalenessMs - STALENESS_STALE_PEAK_MS
  const t = 1 - 1 / (1 + STALENESS_FADE_RATE * overflow)
  return lerpColor(COLOR_STALE, COLOR_FADED, t)
}
