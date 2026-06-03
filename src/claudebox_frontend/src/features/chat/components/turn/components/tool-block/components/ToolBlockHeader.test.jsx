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
})
