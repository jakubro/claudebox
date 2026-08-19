/** Tests for RateLimitItem. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import RateLimitItem from './RateLimitItem'

describe('RateLimitItem', () => {
  it('renders a percentage and a trailing separator', () => {
    const entry = {
      window: 'session',
      status: 'allowed_warning',
      utilization: 0.86,
      resetsAt: null,
    }
    render(<RateLimitItem entry={entry} />)

    const item = screen.getByTestId('footer-rate-limit-session')
    expect(item).toHaveTextContent('Session 86%')
    expect(item.nextElementSibling).toHaveClass('footer-sep')
  })

  it('renders reached text with no percentage, colored red', () => {
    const entry = { window: 'weekly', status: 'rejected', utilization: null, resetsAt: null }
    render(<RateLimitItem entry={entry} />)

    const item = screen.getByTestId('footer-rate-limit-weekly')
    expect(item).toHaveTextContent('Weekly limit reached')
    expect(item).toHaveStyle({ color: 'hsl(0, 45%, 72%)' })
  })

  it('carries window and percentage in the tooltip', () => {
    const entry = {
      window: 'session',
      status: 'allowed_warning',
      utilization: 0.86,
      resetsAt: null,
    }
    render(<RateLimitItem entry={entry} />)

    expect(screen.getByTestId('footer-rate-limit-session')).toHaveAttribute(
      'title',
      expect.stringContaining('86%'),
    )
  })
})
