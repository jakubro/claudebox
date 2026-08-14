/** Tests for ErrorBoundary component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reportRenderError } from '../utils/errorReporting'
import ErrorBoundary from './ErrorBoundary.jsx'

vi.mock('../utils/errorReporting', () => ({ reportRenderError: vi.fn() }))

function Bomb() {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    reportRenderError.mockClear()
    // React logs the caught error to the console too - keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    console.error.mockRestore()
  })

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary label="test">
        <p>content</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('content')).toBeInTheDocument()
    expect(reportRenderError).not.toHaveBeenCalled()
  })

  it('renders the fallback when a child throws', () => {
    render(
      <ErrorBoundary label="test">
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText('This panel stopped responding.')).toBeInTheDocument()
    expect(screen.getByTestId('error-boundary-test')).toBeInTheDocument()
  })

  it('reports the caught error with its label', () => {
    render(
      <ErrorBoundary label="test">
        <Bomb />
      </ErrorBoundary>,
    )

    expect(reportRenderError).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'test', error: expect.any(Error) }),
    )
  })

  it('retry clears the caught error and re-renders the same children', () => {
    let shouldThrow = true

    function Flaky() {
      if (shouldThrow) {
        throw new Error('boom')
      }

      return <p>recovered</p>
    }

    render(
      <ErrorBoundary label="test">
        <Flaky />
      </ErrorBoundary>,
    )

    expect(screen.getByText('This panel stopped responding.')).toBeInTheDocument()

    shouldThrow = false
    fireEvent.click(screen.getByText('Retry'))

    expect(screen.getByText('recovered')).toBeInTheDocument()
  })

  it('clears a caught error when resetKey changes', () => {
    const { rerender } = render(
      <ErrorBoundary label="test" resetKey="session-1">
        <Bomb />
      </ErrorBoundary>,
    )

    expect(screen.getByText('This panel stopped responding.')).toBeInTheDocument()

    rerender(
      <ErrorBoundary label="test" resetKey="session-2">
        <p>next session</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('next session')).toBeInTheDocument()
  })

  it('does not reset when resetKey is unchanged', () => {
    const { rerender } = render(
      <ErrorBoundary label="test" resetKey="session-1">
        <Bomb />
      </ErrorBoundary>,
    )

    rerender(
      <ErrorBoundary label="test" resetKey="session-1">
        <p>still broken</p>
      </ErrorBoundary>,
    )

    expect(screen.getByText('This panel stopped responding.')).toBeInTheDocument()
  })
})
