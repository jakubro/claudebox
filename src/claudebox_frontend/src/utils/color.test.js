/** Tests for color.js interpolation and derived color utilities. */

import { describe, expect, it } from 'vitest'
import {
  deriveFaviconBgColor,
  getStalenessColor,
  hexToRgb,
  hslToRgb,
  lerpColor,
  rgbToHex,
  rgbToHsl,
} from './color'

describe('hexToRgb', () => {
  it('parses black', () => {
    expect(hexToRgb('#000000')).toEqual([0, 0, 0])
  })

  it('parses white', () => {
    expect(hexToRgb('#ffffff')).toEqual([255, 255, 255])
  })

  it('parses red', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
  })
})

describe('rgbToHex', () => {
  it('converts black', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000')
  })

  it('converts white', () => {
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff')
  })

  it('converts arbitrary color', () => {
    expect(rgbToHex(255, 128, 0)).toBe('#ff8000')
  })
})

describe('lerpColor', () => {
  it('returns start color at t=0', () => {
    expect(lerpColor('#000000', '#ffffff', 0)).toBe('#000000')
  })

  it('returns end color at t=1', () => {
    expect(lerpColor('#000000', '#ffffff', 1)).toBe('#ffffff')
  })

  it('returns midpoint at t=0.5', () => {
    const result = lerpColor('#000000', '#ffffff', 0.5)
    // Each channel: round(0 + 255 * 0.5) = 128
    expect(result).toBe('#808080')
  })

  it('clamps t below 0', () => {
    expect(lerpColor('#000000', '#ffffff', -1)).toBe('#000000')
  })

  it('clamps t above 1', () => {
    expect(lerpColor('#000000', '#ffffff', 2)).toBe('#ffffff')
  })

  it('interpolates non-trivial colors', () => {
    // Red to blue at midpoint should give purple-ish
    const result = lerpColor('#ff0000', '#0000ff', 0.5)
    expect(result).toBe('#800080')
  })
})

describe('getStalenessColor', () => {
  it('returns fresh blue at 0s', () => {
    expect(getStalenessColor(0)).toBe('#3b82f6')
  })

  it('returns fresh blue at 15s', () => {
    expect(getStalenessColor(15_000)).toBe('#3b82f6')
  })

  it('reaches purple waypoint at midpoint of 15s-90s', () => {
    const color = getStalenessColor(52_500) // midpoint of 15s-90s
    // Should be exactly the warm waypoint (purple)
    expect(color).toBe('#a855f7')
  })

  it('transitions through warm colors between blue and amber', () => {
    const early = getStalenessColor(30_000) // 25% through
    // Should be between blue and purple, not gray
    expect(early).not.toBe('#3b82f6')
    expect(early).not.toBe('#a855f7')
  })

  it('reaches amber at 90s', () => {
    expect(getStalenessColor(90_000)).toBe('#f59e0b')
  })

  it('fades toward gray beyond 90s', () => {
    const at90 = getStalenessColor(90_000)
    const at300 = getStalenessColor(300_000)
    // Should be different from peak amber
    expect(at300).not.toBe(at90)
  })

  it('approaches but never reaches full gray', () => {
    const veryStale = getStalenessColor(10_000_000)
    // Should be close to gray but not exactly
    expect(veryStale).not.toBe('#4b5563')
    expect(veryStale).not.toBe('#f59e0b')
  })

  it('produces monotonic color shift beyond 90s', () => {
    // Each step should move further from amber toward gray
    const c1 = getStalenessColor(100_000)
    const c2 = getStalenessColor(200_000)
    const c3 = getStalenessColor(500_000)
    // All should be distinct
    expect(new Set([c1, c2, c3]).size).toBe(3)
  })
})

describe('rgbToHsl', () => {
  it('returns zero saturation for grayscale', () => {
    const [h, s, l] = rgbToHsl(128, 128, 128)
    expect(s).toBe(0)
    expect(l).toBeCloseTo(0.502, 2)
    // hue is undefined for grayscale; convention returns 0.
    expect(h).toBe(0)
  })

  it('reports hue 120 for pure green', () => {
    const [h, s, l] = rgbToHsl(0, 255, 0)
    expect(h).toBe(120)
    expect(s).toBe(1)
    expect(l).toBeCloseTo(0.5, 2)
  })

  it('preserves hue across luminosity for the muted-green palette entry', () => {
    // #2a4a2a is dark green; HSL hue should remain 120.
    const [h] = rgbToHsl(0x2a, 0x4a, 0x2a)
    expect(h).toBe(120)
  })
})

describe('hslToRgb', () => {
  it('round-trips through rgbToHsl for saturated colors', () => {
    const [h, s, l] = rgbToHsl(255, 0, 0)
    expect(hslToRgb(h, s, l)).toEqual([255, 0, 0])
  })

  it('returns grayscale when saturation is 0', () => {
    expect(hslToRgb(0, 0, 0.5)).toEqual([128, 128, 128])
  })
})

describe('deriveFaviconBgColor', () => {
  it('brightens the muted green palette entry to a saturated mid-lightness green', () => {
    // Formula: HSL L=0.36, S×1.5. Hue preserved.
    expect(deriveFaviconBgColor('#2a4a2a')).toBe('#368236')
  })

  it('preserves hue across all 8 picker palette entries', () => {
    const palette = [
      '#1e3a5f',
      '#1a4a3a',
      '#4a1e4a',
      '#4a3520',
      '#2a4a2a',
      '#5a3020',
      '#2a2a5a',
      '#5a1e1e',
    ]
    for (const c of palette) {
      const [hSrc] = rgbToHsl(...hexToRgb(c))
      const [hOut] = rgbToHsl(...hexToRgb(deriveFaviconBgColor(c)))
      expect(hOut).toBeCloseTo(hSrc, 0)
    }
  })

  it('sets lightness to 0.36 across the muted palette', () => {
    const out = deriveFaviconBgColor('#1e3a5f')
    const [, , l] = rgbToHsl(...hexToRgb(out))
    expect(l).toBeCloseTo(0.36, 2)
  })
})
