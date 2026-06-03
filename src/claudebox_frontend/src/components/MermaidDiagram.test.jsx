/** Tests for MermaidDiagram component. */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

vi.mock('./CopyButton', () => ({
  default: ({ title }) => (
    <button data-testid="copy-button" title={title} type="button">
      Copy
    </button>
  ),
}))

// Mock mermaid loader — avoids dynamic import issues in jsdom
const mockRenderMermaidChart = vi.fn()

vi.mock('../utils/mermaidLoader', () => ({
  renderMermaidChart: (...args) => mockRenderMermaidChart(...args),
}))

const VALID_CHART = 'graph TD\n    A --> B'
const RENDERED_SVG = '<svg><text>mock diagram</text></svg>'

describe('MermaidDiagram', () => {
  beforeEach(() => {
    mockRenderMermaidChart.mockReset()
    mockRenderMermaidChart.mockResolvedValue({ svg: RENDERED_SVG })
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

      expect(document.body.querySelector('.mermaid-zoom-overlay')).toBeInTheDocument()
      expect(document.body.querySelector('.mermaid-zoom-content').innerHTML).toBe(RENDERED_SVG)
    })

    it('closes zoom overlay on close button click', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      expect(document.body.querySelector('.mermaid-zoom-overlay')).toBeInTheDocument()

      fireEvent.click(document.body.querySelector('.zoom-overlay-close'))
      expect(document.body.querySelector('.mermaid-zoom-overlay')).not.toBeInTheDocument()
    })

    it('closes zoom overlay on Escape key', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      expect(document.body.querySelector('.mermaid-zoom-overlay')).toBeInTheDocument()

      fireEvent.keyDown(document.body.querySelector('.mermaid-zoom-overlay'), { key: 'Escape' })
      expect(document.body.querySelector('.mermaid-zoom-overlay')).not.toBeInTheDocument()
    })

    it('closes zoom overlay on backdrop click', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      expect(document.body.querySelector('.mermaid-zoom-overlay')).toBeInTheDocument()

      fireEvent.click(document.body.querySelector('.mermaid-zoom-overlay'))
      expect(document.body.querySelector('.mermaid-zoom-overlay')).not.toBeInTheDocument()
    })

    it('does not close zoom when clicking zoom content', async () => {
      const { container } = render(<MermaidDiagram chart={VALID_CHART} />)

      await waitFor(() => {
        expect(container.querySelector('.mermaid-diagram')).toBeInTheDocument()
      })

      fireEvent.click(container.querySelector('.mermaid-diagram'))
      fireEvent.click(document.body.querySelector('.mermaid-zoom-content'))

      expect(document.body.querySelector('.mermaid-zoom-overlay')).toBeInTheDocument()
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
})
