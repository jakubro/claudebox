/** Tests for StatusStrip component. */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StatusStrip from './StatusStrip'

// Mock contexts
const mockEventsCtx = { connectionStatus: 'connected' }
vi.mock('../../../../context/EventsContext', () => ({
  useEvents: () => mockEventsCtx,
}))

const mockSessionDataCtx = { lastContextTokens: 50000, contextWindow: 200000 }
vi.mock('../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionDataCtx,
}))

// Mock the color utility but keep a handle on the real implementation for the
// real-progression test below - verifies actual color shifts, not just that the
// component pipes a mocked return value through.
const mockGetContextBarColor = vi.fn(() => '#22c55e')
vi.mock('../../../../utils/color', () => ({
  getContextBarColor: (...args) => mockGetContextBarColor(...args),
}))

describe('StatusStrip', () => {
  beforeEach(() => {
    mockEventsCtx.connectionStatus = 'connected'
    mockSessionDataCtx.lastContextTokens = 50000
    mockSessionDataCtx.contextWindow = 200000
    mockGetContextBarColor.mockReset()
    mockGetContextBarColor.mockReturnValue('#22c55e')
  })

  it('renders connected dot with correct class and title', () => {
    render(<StatusStrip />)

    const dot = screen.getByTitle('Connected')
    expect(dot).toBeInTheDocument()
    expect(dot.className).toContain('connected')
  })

  it('renders disconnected dot with correct class and title', () => {
    mockEventsCtx.connectionStatus = 'disconnected'

    render(<StatusStrip />)

    const dot = screen.getByTitle('Disconnected')
    expect(dot).toBeInTheDocument()
    expect(dot.className).not.toContain('connected')
  })

  it('computes context percentage correctly', () => {
    mockSessionDataCtx.lastContextTokens = 60000
    mockSessionDataCtx.contextWindow = 200000

    render(<StatusStrip />)

    expect(screen.getByText('30%')).toBeInTheDocument()
  })

  it('caps context percentage at 100', () => {
    mockSessionDataCtx.lastContextTokens = 250000
    mockSessionDataCtx.contextWindow = 200000

    render(<StatusStrip />)

    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  it('enforces minimum bar width of 2%', () => {
    mockSessionDataCtx.lastContextTokens = 100
    mockSessionDataCtx.contextWindow = 200000

    const { container } = render(<StatusStrip />)

    const fill = container.querySelector('.status-strip-fill')
    expect(fill.style.width).toBe('2%')
  })

  it('uses actual bar width when above minimum', () => {
    mockSessionDataCtx.lastContextTokens = 100000
    mockSessionDataCtx.contextWindow = 200000

    const { container } = render(<StatusStrip />)

    const fill = container.querySelector('.status-strip-fill')
    expect(fill.style.width).toBe('50%')
  })

  it('fill bar color shifts with usage level (real progression)', async () => {
    // Pull in the real getContextBarColor and route the mock to it. This
    // exercises the actual color-shift behavior rather than asserting that a
    // pre-baked mock value is piped through (which would be tautological).
    const { getContextBarColor: real } = await vi.importActual('../../../../utils/color')
    mockGetContextBarColor.mockImplementation(real)

    const samples = [
      { tokens: 20_000, label: 'low (10%)' }, // blue range
      { tokens: 100_000, label: 'mid (50%)' }, // still blue, exponential curve
      { tokens: 190_000, label: 'high (95%)' }, // shifted toward yellow/orange
    ]

    const colors = []
    for (const { tokens } of samples) {
      mockSessionDataCtx.lastContextTokens = tokens
      mockSessionDataCtx.contextWindow = 200000
      const { container, unmount } = render(<StatusStrip />)
      const fill = container.querySelector('.status-strip-fill')
      colors.push(fill.style.background)
      unmount()
    }

    // jsdom normalizes inline `style.background` to rgb(...) form regardless
    // of input. Parse the channels and assert the actual color shift instead.
    const rgbOf = c =>
      c
        .match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/)
        .slice(1, 4)
        .map(Number)
    const triples = colors.map(rgbOf)

    // All three samples should produce distinct colors (claim: color "shifts")
    expect(new Set(triples.map(t => t.join(','))).size).toBe(3)
    // Progression toward yellow/orange: red rises, blue falls as usage rises
    expect(triples[2][0]).toBeGreaterThan(triples[0][0]) // red increases
    expect(triples[2][2]).toBeLessThan(triples[0][2]) // blue decreases
  })
})
