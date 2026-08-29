/** Tests for MermaidDiagram component. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MermaidDiagram from './MermaidDiagram'

// Mock react-syntax-highlighter (heavy, uses DOM APIs not available in jsdom)
vi.mock('react-syntax-highlighter', () => ({
  default: ({ children, language }) => (
    <pre data-testid="syntax-highlighter" data-language={language}>
      {children}
    </pre>
  ),
}))

vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({
  vs2015: {},
}))

vi.mock('../../CopyButton', () => ({
  default: ({ title }) => (
    <button data-testid="copy-button" title={title} type="button">
      Copy
    </button>
  ),
}))

// Mock mermaid loader - avoids dynamic import issues in jsdom
const mockRenderMermaidChart = vi.fn()
const mockGetCachedMermaidSvg = vi.fn()
const mockRemoveMermaidRenderArtifacts = vi.fn()

vi.mock('../../../utils/mermaidLoader', () => ({
  renderMermaidChart: (...args) => mockRenderMermaidChart(...args),
  getCachedMermaidSvg: (...args) => mockGetCachedMermaidSvg(...args),
  removeMermaidRenderArtifacts: (...args) => mockRemoveMermaidRenderArtifacts(...args),
}))

const VALID_CHART = 'graph TD\n    A --> B'
const RENDERED_SVG = '<svg><text>mock diagram</text></svg>'

describe('MermaidDiagram', () => {
  beforeEach(() => {
    mockRenderMermaidChart.mockReset()
    mockRenderMermaidChart.mockResolvedValue({ svg: RENDERED_SVG })
    mockGetCachedMermaidSvg.mockReset()
    mockGetCachedMermaidSvg.mockReturnValue(null)
    mockRemoveMermaidRenderArtifacts.mockReset()
  })

  describe('rendering', () => {
    it('shows loading state initially', () => {
      mockRenderMermaidChart.mockReturnValue(new Promise(() => {}))

      render(<MermaidDiagram chart={VALID_CHART} />)

      expect(screen.getByText('Rendering diagram...')).toBeInTheDocument()
    })

    it('renders SVG diagram from valid mermaid source', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      expect(container.querySelector('.mermaid-diagram').innerHTML).toBe(RENDERED_SVG)
    })

    it('calls renderMermaidChart with unique ID and chart source', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      expect(mockRenderMermaidChart).toHaveBeenCalledWith(
        expect.stringContaining('mermaid-'),
        VALID_CHART,
      )
    })
  })

  describe('error fallback', () => {
    it('falls back to syntax highlighter on invalid mermaid', async () => {
      mockRenderMermaidChart.mockRejectedValue(new Error('Parse error'))

      render(<MermaidDiagram chart="invalid{{{" />)

      await waitFor(() => {
        expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      })

      expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'mermaid')
      expect(screen.getByTestId('syntax-highlighter')).toHaveTextContent('invalid{{{')
    })

    it('shows copy button in fallback mode', async () => {
      mockRenderMermaidChart.mockRejectedValue(new Error('Parse error'))

      render(<MermaidDiagram chart="bad" />)

      await waitFor(() => {
        expect(screen.getByTestId('copy-button')).toBeInTheDocument()
      })
    })
  })

  describe('failure notice', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows the thrown message once the source has settled', async () => {
      mockRenderMermaidChart.mockRejectedValue(new Error('Parse error on line 3: bad token'))

      render(<MermaidDiagram chart="invalid{{{" />)

      await waitFor(() => {
        expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      })
      expect(document.querySelector('.mermaid-failure-notice')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(document.querySelector('.mermaid-failure-notice')).toBeInTheDocument()
      expect(document.querySelector('.mermaid-failure-text').textContent).toContain(
        'Parse error on line 3: bad token',
      )
    })

    it('falls back to a generic line when the thrown error carries no message', async () => {
      mockRenderMermaidChart.mockRejectedValue(new Error())

      render(<MermaidDiagram chart="invalid{{{" />)

      await waitFor(() => {
        expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(document.querySelector('.mermaid-failure-text').textContent).toBe(
        'Diagram failed to draw',
      )
    })

    it('distinguishes an unsupported diagram type from a syntax error', async () => {
      mockRenderMermaidChart.mockRejectedValue(
        new Error('No diagram type detected matching given configuration'),
      )

      render(<MermaidDiagram chart="wardley-beta\ntitle x" />)

      await waitFor(() => {
        expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(document.querySelector('.mermaid-failure-text').textContent).toContain(
        'No diagram type detected matching given configuration',
      )
      expect(document.querySelector('.mermaid-failure-text').textContent).not.toContain(
        'Parse error',
      )
    })

    it('never shows the notice while the source keeps changing', async () => {
      mockRenderMermaidChart.mockRejectedValue(new Error('Parse error'))

      const { rerender } = render(<MermaidDiagram chart="invalid{{{1" />)

      await waitFor(() => {
        expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      })

      // A streaming flush arrives before the settle window elapses - cancels the pending reveal.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })
      rerender(<MermaidDiagram chart="invalid{{{12" />)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(400)
      })

      expect(document.querySelector('.mermaid-failure-notice')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(350)
      })

      expect(document.querySelector('.mermaid-failure-notice')).toBeInTheDocument()
    })

    it('shows no notice for a diagram that draws successfully', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      await act(async () => {
        await vi.advanceTimersByTimeAsync(750)
      })

      expect(document.querySelector('.mermaid-failure-notice')).not.toBeInTheDocument()
    })
  })

  describe('toggle', () => {
    it('shows source view when toggle clicked', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      const toggleBtn = container.querySelector('.mermaid-toolbar-btn')
      fireEvent.click(toggleBtn)

      expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      expect(screen.getByTestId('syntax-highlighter').textContent).toBe(VALID_CHART)
    })

    it('switches back to diagram when toggled again', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      const toggleBtn = container.querySelector('.mermaid-toolbar-btn')
      fireEvent.click(toggleBtn)

      expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()

      // Click the toggle again (in source view it has .pressed class)
      const pressedBtn = container.querySelector('.mermaid-toolbar-btn.pressed')
      fireEvent.click(pressedBtn)

      expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
    })

    it('shows copy button in source view', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      const toggleBtn = container.querySelector('.mermaid-toolbar-btn')
      fireEvent.click(toggleBtn)

      expect(screen.getByTestId('copy-button')).toBeInTheDocument()
    })
  })

  describe('zoom', () => {
    it('opens zoom overlay when diagram clicked', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))

      expect(document.body.querySelector('.zoom-overlay')).toBeInTheDocument()
      expect(document.body.querySelector('.mermaid-zoom-inner').innerHTML).toBe(RENDERED_SVG)
    })

    it('closes zoom overlay on close button click', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      expect(document.body.querySelector('.zoom-overlay')).toBeInTheDocument()

      fireEvent.click(document.body.querySelector('.zoom-overlay-close'))
      expect(document.body.querySelector('.zoom-overlay')).not.toBeInTheDocument()
    })

    it('closes zoom overlay on Escape key', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      expect(document.body.querySelector('.zoom-overlay')).toBeInTheDocument()

      fireEvent.keyDown(document.body.querySelector('.zoom-overlay'), { key: 'Escape' })
      expect(document.body.querySelector('.zoom-overlay')).not.toBeInTheDocument()
    })

    it('closes zoom overlay on backdrop click', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      expect(document.body.querySelector('.zoom-overlay')).toBeInTheDocument()

      fireEvent.click(document.body.querySelector('.zoom-overlay'))
      expect(document.body.querySelector('.zoom-overlay')).not.toBeInTheDocument()
    })

    it('does not close zoom when clicking zoom content', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      fireEvent.click(document.body.querySelector('.mermaid-zoom-content'))

      expect(document.body.querySelector('.zoom-overlay')).toBeInTheDocument()
    })
  })

  describe('toolbar', () => {
    it('shows copy button in diagram view', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      expect(screen.getByTestId('copy-button')).toBeInTheDocument()
    })
  })

  describe('cache restore', () => {
    it('restores a cached diagram instantly without the loading placeholder or a redraw', () => {
      mockGetCachedMermaidSvg.mockReturnValue(RENDERED_SVG)

      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      expect(screen.queryByText('Rendering diagram...')).not.toBeInTheDocument()
      expect(container.querySelector('.mermaid-diagram').innerHTML).toBe(RENDERED_SVG)
      expect(mockRenderMermaidChart).not.toHaveBeenCalled()
    })

    it('restores a cached diagram on a fresh mount for the same source (simulated remount)', () => {
      mockGetCachedMermaidSvg.mockReturnValue(RENDERED_SVG)

      const { unmount } = render(<MermaidDiagram chart={VALID_CHART} />)
      unmount()
      mockRenderMermaidChart.mockClear()

      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      expect(screen.queryByText('Rendering diagram...')).not.toBeInTheDocument()
      expect(container.querySelector('.mermaid-diagram').innerHTML).toBe(RENDERED_SVG)
      expect(mockRenderMermaidChart).not.toHaveBeenCalled()
    })
  })

  describe('failure cleanup', () => {
    it('sweeps render artifacts via the loader on a failed draw', async () => {
      mockRenderMermaidChart.mockRejectedValue(new Error('Parse error'))

      render(<MermaidDiagram chart="invalid{{{" />)

      await waitFor(() => {
        expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      })

      expect(mockRemoveMermaidRenderArtifacts).toHaveBeenCalledTimes(1)
      expect(mockRemoveMermaidRenderArtifacts).toHaveBeenCalledWith(
        expect.stringContaining('mermaid-'),
      )
    })
  })
})
