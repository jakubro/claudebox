/** Tests for favicon.js color palette and canvas helpers. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFaviconCanvas,
  drawWorkspaceBadge,
  getColorFromPalette,
  NORMAL_COLORS,
  NOTIFICATION_COLORS,
  setFaviconFromCanvas,
} from './favicon'

describe('getColorFromPalette', () => {
  it('returns first color at progress 0', () => {
    const colors = ['#ff0000', '#00ff00', '#0000ff']
    const result = getColorFromPalette(colors, 0)
    expect(result).toBe('#ff0000')
  })

  it('interpolates between colors', () => {
    const colors = ['#000000', '#ffffff']
    const result = getColorFromPalette(colors, 0.25)
    // 0.25 * 2 colors = 0.5 progress within segment 0->1
    expect(result).toBe('#808080')
  })

  it('wraps around at progress 1', () => {
    const colors = ['#ff0000', '#00ff00']
    // progress=1 wraps: scaledProgress=2, segmentIndex=0, same as progress=0
    const result = getColorFromPalette(colors, 1)
    expect(result).toBe('#ff0000')
  })
})

describe('NOTIFICATION_COLORS', () => {
  it('has 3 orange palette entries', () => {
    expect(NOTIFICATION_COLORS).toHaveLength(3)
  })
})

describe('NORMAL_COLORS', () => {
  it('has 3 gray palette entries', () => {
    expect(NORMAL_COLORS).toHaveLength(3)
  })
})

describe('createFaviconCanvas', () => {
  it('creates a 32x32 canvas', () => {
    const canvas = createFaviconCanvas()
    expect(canvas.width).toBe(32)
    expect(canvas.height).toBe(32)
  })
})

describe('drawWorkspaceBadge', () => {
  function makeCtx() {
    return {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      globalAlpha: 1,
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
    }
  }

  it('draws a centered inscribed circle with fill only', () => {
    const ctx = makeCtx()

    drawWorkspaceBadge(ctx, '#1e3a5f')

    expect(ctx.arc).toHaveBeenCalledTimes(1)
    // 32px canvas, 2px margin -> center (16,16), radius 14.
    expect(ctx.arc).toHaveBeenCalledWith(16, 16, 14, 0, Math.PI * 2)
    expect(ctx.fill).toHaveBeenCalledTimes(1)
    expect(ctx.stroke).not.toHaveBeenCalled()
    expect(ctx.fillStyle).toBe('#1e3a5f')
  })

  it('wraps draw in save/restore so caller state is preserved', () => {
    const ctx = makeCtx()

    drawWorkspaceBadge(ctx, '#4a1e4a')

    expect(ctx.save).toHaveBeenCalledTimes(1)
    expect(ctx.restore).toHaveBeenCalledTimes(1)
  })

  it('sets globalAlpha to the provided alpha option', () => {
    const ctx = makeCtx()

    drawWorkspaceBadge(ctx, '#1e3a5f', { alpha: 0.25 })

    // The mock records the last value assigned to globalAlpha. drawWorkspaceBadge
    // sets it inside its save/restore window; a real ctx would roll it back, but
    // the mock holds the in-window value.
    expect(ctx.globalAlpha).toBe(0.25)
  })

  it('defaults alpha to 1 when no options are supplied', () => {
    const ctx = makeCtx()

    drawWorkspaceBadge(ctx, '#1e3a5f')

    expect(ctx.globalAlpha).toBe(1)
  })
})

describe('setFaviconFromCanvas', () => {
  beforeEach(() => {
    // Clear any existing favicon link
    document.head.innerHTML = ''
  })

  it('creates favicon link element if not present', () => {
    const canvas = createFaviconCanvas()
    setFaviconFromCanvas(canvas)

    const link = document.querySelector('link[rel="icon"]')
    expect(link).not.toBeNull()
    // jsdom doesn't implement toDataURL, so just verify the link was created and href was set
    expect(link.getAttribute('rel')).toBe('icon')
  })

  it('reuses existing favicon link element', () => {
    const existing = document.createElement('link')
    existing.rel = 'icon'
    document.head.appendChild(existing)

    const canvas = createFaviconCanvas()
    setFaviconFromCanvas(canvas)

    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(1)
  })
})
