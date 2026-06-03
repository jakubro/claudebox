/** Canvas drawing functions for dynamic favicon. */

import { lerpColor } from '../../../utils/color'

export const FAVICON_SIZE = 32 // audit-ignore: misplaced-constant

// Colors matching footer status-working animation (darker for better contrast)
const CYCLE_COLORS = ['#2563eb', '#7c3aed', '#a21caf']

// Notification gradient colors (orange palette)
export const NOTIFICATION_COLORS = ['#fbbf24', '#f97316', '#ea580c']

// Normal state gradient colors (subtle gray tint at lower-left)
export const NORMAL_COLORS = ['#ffffff', '#f3f4f6', '#9ca3af']

// Solid white C-arc — used when a workspace color tints the favicon background.
export const WHITE_GRADIENT = ['#ffffff', '#ffffff', '#ffffff']

const BREATH_MIN_INTENSITY = 0.5 // never fade below this (avoids looking like idle state)

// C-shape arc parameters (gap facing right)
const GAP_SIZE = 0.8 // radians for gap on each side // audit-ignore: misplaced-constant
const ARC_START = GAP_SIZE
const ARC_END = Math.PI * 2 - GAP_SIZE

// Gradient parameters
const GRADIENT_SEGMENTS = 30
export const NOTIFICATION_OFFSET = 0.25 // Shift notification gradient (reddish at upper-left)
export const NORMAL_OFFSET = 0.35 // Shift normal gradient (gray at lower-left)

// Workspace badge geometry — centered circle inscribed in the canvas with a
// 2 px transparent margin on every side. C-arc renders on top.
const BADGE_MARGIN = 2
const BADGE_CENTER = FAVICON_SIZE / 2
const BADGE_RADIUS = FAVICON_SIZE / 2 - BADGE_MARGIN

/** Workspace bg alpha during notification state (constant dim). */
export const NOTIFICATION_BG_ALPHA = 0.5
/** Workspace bg alpha at peak breath during processing — multiplied by the
 * breath intensity ∈ [0.5, 1.0] so the effective range is [0.25, 0.5]. */
export const BREATHING_BG_PEAK_ALPHA = 0.5

export function getColorFromPalette(colors, progress) {
  const totalSegments = colors.length
  const scaledProgress = progress * totalSegments
  const segmentIndex = Math.floor(scaledProgress) % totalSegments
  const nextIndex = (segmentIndex + 1) % totalSegments
  const segmentProgress = scaledProgress - Math.floor(scaledProgress)

  return lerpColor(colors[segmentIndex], colors[nextIndex], segmentProgress)
}

/**
 * Draw C-shaped favicon with static gradient along the arc.
 *
 * Caller is responsible for clearing / preparing the canvas — this function
 * composes on top of whatever the canvas currently holds so a workspace-color
 * background can render underneath the arc.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string[]} colors - Gradient palette.
 * @param {number} [offset=0] - Gradient offset.
 */
export function drawGradientFavicon(ctx, colors, offset = 0) {
  const size = FAVICON_SIZE
  const center = size / 2
  const radius = size / 2 - 2
  const arcLength = ARC_END - ARC_START
  const segmentLength = arcLength / GRADIENT_SEGMENTS

  ctx.lineWidth = 4
  ctx.lineCap = 'round'

  for (let i = 0; i < GRADIENT_SEGMENTS; i++) {
    const start = ARC_START + i * segmentLength
    const end = start + segmentLength + 0.02

    // Color based on position along arc with offset
    const position = (i / GRADIENT_SEGMENTS + offset) % 1
    const color = getColorFromPalette(colors, position)

    ctx.beginPath()
    ctx.arc(center, center, radius, start, Math.min(end, ARC_END))
    ctx.strokeStyle = color
    ctx.stroke()
  }
}

/**
 * Compute the breath-cycle intensity for a phase ∈ [0, 1].
 *
 * Sine wave clamped at BREATH_MIN_INTENSITY so the favicon never fades to
 * the idle look. Returns a value in [BREATH_MIN_INTENSITY, 1]. Exposed for
 * callers that want to pulse other elements (workspace bg alpha) in sync
 * with the C-arc breath.
 *
 * @param {number} breathPhase - Phase of breath cycle (0-1).
 */
export function computeBreathIntensity(breathPhase) {
  const rawIntensity = (Math.sin(breathPhase * Math.PI * 2 - Math.PI / 2) + 1) / 2
  return BREATH_MIN_INTENSITY + rawIntensity * (1 - BREATH_MIN_INTENSITY)
}

/**
 * Draw C-shaped favicon with breathing effect.
 *
 * Fades between white and gradient colors using sine wave.
 * Frame timing irregularities feel organic rather than broken.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} breathPhase - Phase of breath cycle (0-1).
 */
export function drawBreathingFavicon(ctx, breathPhase) {
  const intensity = computeBreathIntensity(breathPhase)
  // Interpolate each color in the gradient toward white
  const breathColors = CYCLE_COLORS.map(color => lerpColor('#ffffff', color, intensity))
  drawGradientFavicon(ctx, breathColors, NORMAL_OFFSET)
}

/**
 * Draw a workspace-tinted circle inscribed in the favicon canvas.
 *
 * Renders a centered disc with a 2 px transparent margin so the disc is
 * inscribed inside the favicon edges. Caller draws the C-arc on top
 * separately; the alpha option scopes only this draw so the arc keeps its
 * own opacity.
 *
 * Caller skips the call when `color` is falsy. Coexists with `drawDevBadge`.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} color - Hex color in `#rrggbb` form (trusted, no validation).
 * @param {{ alpha?: number }} [options] - Global alpha for this draw [0, 1]. Defaults to 1.
 */
export function drawWorkspaceBadge(ctx, color, { alpha = 1 } = {}) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.beginPath()
  ctx.arc(BADGE_CENTER, BADGE_CENTER, BADGE_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

/** Draw orange dot at bottom-right corner in dev mode. */
export function drawDevBadge(ctx) {
  if (!import.meta.env.DEV) {
    return
  }
  const size = FAVICON_SIZE
  ctx.beginPath()
  ctx.arc(size - 7, size - 7, 7, 0, Math.PI * 2)
  ctx.fillStyle = '#f59e0b'
  ctx.fill()
}

export function setFaviconFromCanvas(canvas) {
  let link = document.querySelector('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.appendChild(link)
  }
  link.href = canvas.toDataURL('image/png')
}

export function createFaviconCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = FAVICON_SIZE
  canvas.height = FAVICON_SIZE
  return canvas
}
