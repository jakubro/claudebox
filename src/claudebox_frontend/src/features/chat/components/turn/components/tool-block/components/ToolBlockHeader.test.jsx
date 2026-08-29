/** Tests for ToolBlockHeader component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ToolBlockHeader from './ToolBlockHeader'

// Mock only getToolIcon (has icon component dependency)
vi.mock('../utils/helpers', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    getToolIcon: vi.fn(() => null),
  }
})

describe('ToolBlockHeader', () => {
  const defaultToolStatus = {
    isPending: false,
    isAwaitingAnswer: false,
    wasAnswered: false,
    wasSkipped: false,
    isError: false,
    answerLabel: null,
    taskNotification: null,
    blockDuration: null,
    blockRelativeTime: null,
  }

  const defaultProps = {
    header: 'Read(file.txt)',
    toolName: 'Read',
    summary: 'Read 10 lines',
    hasExpandable: true,
    onToggle: vi.fn(),
    toolStatus: defaultToolStatus,
  }

  it('renders header text', () => {
    render(<ToolBlockHeader {...defaultProps} />)

    expect(screen.getByText('Read(file.txt)')).toBeInTheDocument()
  })

  it('shows tooltip when provided', () => {
    render(<ToolBlockHeader {...defaultProps} tooltip="/home/user/project/src/file.txt" />)

    const toolName = screen.getByText('Read(file.txt)')
    expect(toolName).toHaveAttribute('title', '/home/user/project/src/file.txt')
  })

  it('has no title attribute when tooltip not provided', () => {
    render(<ToolBlockHeader {...defaultProps} />)

    const toolName = screen.getByText('Read(file.txt)')
    expect(toolName).not.toHaveAttribute('title')
  })

  it('shows spinner when pending', () => {
    render(
      <ToolBlockHeader {...defaultProps} toolStatus={{ ...defaultToolStatus, isPending: true }} />,
    )

    expect(document.querySelector('.spinner')).toBeInTheDocument()
  })

  it('applies pointer cursor when hasExpandable', () => {
    render(<ToolBlockHeader {...defaultProps} hasExpandable={true} />)

    const header = document.querySelector('.tool-header-area')
    expect(header).toHaveStyle({ cursor: 'pointer' })
  })

  it('applies default cursor when not expandable', () => {
    render(<ToolBlockHeader {...defaultProps} hasExpandable={false} />)

    const header = document.querySelector('.tool-header-area')
    expect(header).toHaveStyle({ cursor: 'default' })
  })

  describe('onToggle callback', () => {
    it('calls onToggle when header area is clicked', () => {
      const onToggle = vi.fn()
      render(<ToolBlockHeader {...defaultProps} onToggle={onToggle} />)

      const headerArea = document.querySelector('.tool-header-area')
      fireEvent.click(headerArea)

      expect(onToggle).toHaveBeenCalledTimes(1)
    })
  })

  describe('error styling', () => {
    it('applies error class to tool-summary when isError is true', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          summary="Something failed"
          toolStatus={{ ...defaultToolStatus, isError: true }}
        />,
      )

      const summary = document.querySelector('.tool-summary.error')
      expect(summary).toBeInTheDocument()
    })

    it('sets title attribute on summary when isError is true', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          summary="Error details here"
          toolStatus={{ ...defaultToolStatus, isError: true }}
        />,
      )

      const summary = document.querySelector('.tool-summary.error')
      expect(summary).toHaveAttribute('title', 'Error details here')
    })

    it('does not apply error class when isError is false', () => {
      render(<ToolBlockHeader {...defaultProps} />)

      const summary = document.querySelector('.tool-summary')
      expect(summary).not.toHaveClass('error')
    })
  })

  describe('bullet status classes', () => {
    it('shows pending bullet class when isPending is true', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, isPending: true }}
        />,
      )

      const bullet = document.querySelector('.tool-bullet')
      expect(bullet).toHaveClass('pending')
    })

    it('shows error bullet class when isError is true', () => {
      render(
        <ToolBlockHeader {...defaultProps} toolStatus={{ ...defaultToolStatus, isError: true }} />,
      )

      const bullet = document.querySelector('.tool-bullet')
      expect(bullet).toHaveClass('error')
    })

    it('shows completed bullet class for normal completed tool', () => {
      render(<ToolBlockHeader {...defaultProps} />)

      const bullet = document.querySelector('.tool-bullet')
      expect(bullet).toHaveClass('completed')
    })

    it('shows killed bullet class when taskNotification status is killed', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, taskNotification: { status: 'killed' } }}
        />,
      )

      const bullet = document.querySelector('.tool-bullet')
      expect(bullet).toHaveClass('killed')
    })
  })

  describe('block timing', () => {
    it('renders timing when blockDuration and blockRelativeTime are provided', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, blockDuration: 2, blockRelativeTime: 8 }}
        />,
      )

      const timing = document.querySelector('.block-timing')
      expect(timing).toBeInTheDocument()
      expect(timing).toHaveTextContent('2s · @ +8s')
    })

    it('renders only relative time when blockDuration is null', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, blockRelativeTime: 5 }}
        />,
      )

      const timing = document.querySelector('.block-timing')
      expect(timing).toBeInTheDocument()
      expect(timing).toHaveTextContent('@ +5s')
    })

    it('does not render timing when both are null', () => {
      render(<ToolBlockHeader {...defaultProps} />)

      expect(document.querySelector('.block-timing')).not.toBeInTheDocument()
    })
  })

  describe('wasSkipped behavior', () => {
    it('shows Skipped summary for AskUserQuestion when wasSkipped is true', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolName="AskUserQuestion"
          header="AskUserQuestion(1 question)"
          summary="1 question"
          toolStatus={{ ...defaultToolStatus, wasSkipped: true }}
        />,
      )

      const summary = document.querySelector('.tool-summary')
      expect(summary).toHaveTextContent('Skipped')
    })

    it('does not show Skipped for non-AskUserQuestion tools', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolName="Read"
          summary="Read 10 lines"
          toolStatus={{ ...defaultToolStatus, wasSkipped: true }}
        />,
      )

      const summary = document.querySelector('.tool-summary')
      expect(summary).toHaveTextContent('Read 10 lines')
    })
  })

  describe('open-in-editor affordance', () => {
    it('renders the affordance when editorUrl is provided', () => {
      render(<ToolBlockHeader {...defaultProps} editorUrl="vscode://file/src/app.js:1" />)

      expect(document.querySelector('.tool-open-in-editor-btn')).toBeInTheDocument()
    })

    it('does not render the affordance when editorUrl is absent', () => {
      render(<ToolBlockHeader {...defaultProps} />)

      expect(document.querySelector('.tool-open-in-editor-btn')).not.toBeInTheDocument()
    })

    it('opens the resolved URL and does not toggle the block on click', () => {
      const onToggle = vi.fn()
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})

      render(
        <ToolBlockHeader
          {...defaultProps}
          onToggle={onToggle}
          editorUrl="vscode://file/src/app.js:1"
        />,
      )

      fireEvent.click(document.querySelector('.tool-open-in-editor-btn'))

      expect(openSpy).toHaveBeenCalledWith(
        'vscode://file/src/app.js:1',
        '_blank',
        'noopener,noreferrer',
      )
      expect(onToggle).not.toHaveBeenCalled()

      openSpy.mockRestore()
    })
  })

  describe('activity line (pending Task)', () => {
    it('renders no activity content when activity is absent - a bare spinner, like any other tool', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, isPending: true }}
        />,
      )

      expect(document.querySelector('.spinner')).toBeInTheDocument()
      expect(document.querySelector('.tool-activity')).not.toBeInTheDocument()
    })

    it('renders a call activity as a status dot plus title', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, isPending: true }}
          activity={{ kind: 'call', status: 'pending', title: 'Bash(check pytest status)' }}
        />,
      )

      const activity = screen.getByText('Bash(check pytest status)')
      expect(activity).toHaveClass('tool-activity')
      // Scoped to .tool-result - the main header carries its own .tool-bullet for the Task itself.
      const bullets = document.querySelectorAll('.tool-result .tool-bullet')
      expect(bullets).toHaveLength(1)
      expect(bullets[0]).toHaveClass('pending')
    })

    it("a completed call activity carries the completed dot, distinct from the Task's own pending bullet", () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, isPending: true }}
          activity={{ kind: 'call', status: 'completed', title: 'Read(config.json)' }}
        />,
      )

      const bullets = document.querySelectorAll('.tool-result .tool-bullet')
      expect(bullets).toHaveLength(1)
      expect(bullets[0]).toHaveClass('completed')
      // The Task's own bullet stays pending even though the nested call completed.
      expect(document.querySelector('.tool-header .tool-bullet')).toHaveClass('pending')
    })

    it('renders a text activity as a single line, no status dot', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, isPending: true }}
          activity={{ kind: 'text', text: 'The parser is split across two files; reading both.' }}
        />,
      )

      expect(screen.getByText('The parser is split across two files; reading both.')).toHaveClass(
        'tool-activity',
      )
      expect(document.querySelectorAll('.tool-result .tool-bullet')).toHaveLength(0)
    })

    it('does not render an activity when not pending, even if provided', () => {
      render(
        <ToolBlockHeader
          {...defaultProps}
          toolStatus={{ ...defaultToolStatus, isPending: false }}
          activity={{ kind: 'text', text: 'Should not show - the block is no longer pending' }}
        />,
      )

      expect(document.querySelector('.tool-activity')).not.toBeInTheDocument()
    })
  })
})
