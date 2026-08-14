/** Tests for errorReporting utils. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportError } from '../api/errorReport'
import { reportRenderError } from './errorReporting'

vi.mock('../api/errorReport', () => ({ reportError: vi.fn() }))

describe('reportRenderError', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    reportError.mockClear()
  })

  afterEach(() => {
    console.error.mockRestore()
  })

  it('logs the label, error, and component stack', () => {
    const error = new Error('boom')

    reportRenderError({ label: 'chat', error, componentStack: '  at Chat' })

    expect(console.error).toHaveBeenCalledWith(
      'ErrorBoundary(chat): render failed',
      error,
      '  at Chat',
    )
  })

  it('forwards a render-failure report to the daemon', () => {
    const error = new Error('boom')

    reportRenderError({ label: 'chat', error, componentStack: '  at Chat' })

    expect(reportError).toHaveBeenCalledWith({
      kind: 'render-failure',
      message: 'chat: boom',
      stack: '  at Chat',
    })
  })
})
