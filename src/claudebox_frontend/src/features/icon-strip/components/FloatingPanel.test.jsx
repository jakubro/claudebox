/** Tests for FloatingPanel component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FloatingPanel from './FloatingPanel'

// Mock panel components via config/layout
vi.mock('../../../config/layout', () => ({
  components: {
    sessions: () => <div data-testid="panel-sessions">Sessions Panel</div>,
    todos: () => <div data-testid="panel-todos">Todos Panel</div>,
    logs: () => <div data-testid="panel-logs">Logs Panel</div>,
    containers: () => <div data-testid="panel-containers">Containers Panel</div>,
  },
}))

const defaultProps = {
  panelId: 'sessions',
  anchorRect: { top: 100, right: 32, left: 0, bottom: 132 },
  position: 'left',
  onMouseEnter: vi.fn(),
  onMouseLeave: vi.fn(),
  onDismiss: vi.fn(),
}

describe('FloatingPanel', () => {
  it('renders panel content when panelId and anchorRect are provided', () => {
    render(<FloatingPanel {...defaultProps} />)

    expect(screen.getByTestId('panel-sessions')).toBeInTheDocument()
  })

  it('renders nothing when panelId is null', () => {
    const { container } = render(<FloatingPanel {...defaultProps} panelId={null} />)

    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when anchorRect is null', () => {
    const { container } = render(<FloatingPanel {...defaultProps} anchorRect={null} />)

    expect(container.firstChild).toBeNull()
  })

  it('positions to the right of anchor for left strip', () => {
    const { container } = render(<FloatingPanel {...defaultProps} position="left" />)

    const panel = container.querySelector('.floating-panel')
    expect(panel.style.left).toBe('32px')
    expect(panel.style.top).toBe('100px')
  })

  it('positions to the left of anchor for right strip', () => {
    // Mock window.innerWidth
    Object.defineProperty(window, 'innerWidth', { value: 1024, writable: true })

    const rightAnchor = { top: 100, right: 1024, left: 992, bottom: 132 }
    const { container } = render(
      <FloatingPanel {...defaultProps} anchorRect={rightAnchor} position="right" />,
    )

    const panel = container.querySelector('.floating-panel')
    expect(panel.style.right).toBe('32px') // 1024 - 992
    expect(panel.style.top).toBe('100px')
  })

  it('calls onMouseEnter when cursor enters the panel', () => {
    const onMouseEnter = vi.fn()
    const { container } = render(<FloatingPanel {...defaultProps} onMouseEnter={onMouseEnter} />)

    fireEvent.mouseEnter(container.querySelector('.floating-panel'))
    expect(onMouseEnter).toHaveBeenCalledTimes(1)
  })

  it('calls onMouseLeave when cursor leaves the panel', () => {
    const onMouseLeave = vi.fn()
    const { container } = render(<FloatingPanel {...defaultProps} onMouseLeave={onMouseLeave} />)

    fireEvent.mouseLeave(container.querySelector('.floating-panel'))
    expect(onMouseLeave).toHaveBeenCalledTimes(1)
  })

  it('calls onDismiss on Escape key', () => {
    const onDismiss = vi.fn()
    render(<FloatingPanel {...defaultProps} onDismiss={onDismiss} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('renders the correct panel component based on panelId', () => {
    render(<FloatingPanel {...defaultProps} panelId="todos" />)

    expect(screen.getByTestId('panel-todos')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-sessions')).not.toBeInTheDocument()
  })

  it('applies floating-panel-left class for left position', () => {
    const { container } = render(<FloatingPanel {...defaultProps} position="left" />)

    expect(container.querySelector('.floating-panel')).toHaveClass('floating-panel-left')
  })

  it('applies floating-panel-right class for right position', () => {
    const { container } = render(<FloatingPanel {...defaultProps} position="right" />)

    expect(container.querySelector('.floating-panel')).toHaveClass('floating-panel-right')
  })

  describe('wide-panel sizing', () => {
    // Wide panels use min(innerWidth, max(800, innerWidth * 0.6)). At
    // innerWidth=1600 → min(1600, max(800, 960)) = 960. At innerWidth=1024 →
    // min(1024, max(800, 614)) = 800. Both ≥ 800px floor.

    it('logs panel uses wide sizing (width ≥ 800px)', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true })

      const { container } = render(<FloatingPanel {...defaultProps} panelId="logs" />)
      const panel = container.querySelector('.floating-panel')
      const width = parseInt(panel.style.width, 10)

      expect(width).toBeGreaterThanOrEqual(800)
    })

    it('containers panel uses wide sizing (width ≥ 800px)', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true })

      const { container } = render(<FloatingPanel {...defaultProps} panelId="containers" />)
      const panel = container.querySelector('.floating-panel')
      const width = parseInt(panel.style.width, 10)

      expect(width).toBeGreaterThanOrEqual(800)
    })

    it('narrow panels (sessions, todos) use the standard 300px width', () => {
      Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true })

      const { container: sessionsContainer } = render(
        <FloatingPanel {...defaultProps} panelId="sessions" />,
      )
      const sessionsWidth = parseInt(
        sessionsContainer.querySelector('.floating-panel').style.width,
        10,
      )
      expect(sessionsWidth).toBe(300)

      const { container: todosContainer } = render(
        <FloatingPanel {...defaultProps} panelId="todos" />,
      )
      const todosWidth = parseInt(todosContainer.querySelector('.floating-panel').style.width, 10)
      expect(todosWidth).toBe(300)
    })
  })
})
