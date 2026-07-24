/** Tests for Turn. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Turn from './Turn'
import { TurnCollapseProvider } from './TurnCollapseContext'

vi.mock('../../../../hooks/useCapabilities', () => ({
  default: () => ({ capabilities: null, runtimeName: null }),
}))

// Mock heavy external libraries only
vi.mock('../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

// SlashCommandToken hits SessionDataContext for command resolution; the
// Turn test renders the component without a provider, so stub it to a
// plain span that preserves the existing assertion contract.
vi.mock('./components/user-message-content/SlashCommandToken', () => ({
  default: ({ cmd }) => <span className="slash-command">{cmd}</span>,
}))

vi.mock('../tools/tool-block', () => ({
  default: ({ toolUse }) => (
    <div data-testid="tool-block" data-tool-use-id={toolUse.tool_use_id}>
      {toolUse.content}
    </div>
  ),
}))

describe('Turn', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // Helper: build realistic SSE events for processEvents
  const textEvent = (content, ts) => ({
    type: 'assistant',
    subtype: 'text',
    content,
    ts: ts || new Date().toISOString(),
  })

  const thinkingEvent = (content, ts) => ({
    type: 'assistant',
    subtype: 'thinking',
    content,
    ts: ts || new Date().toISOString(),
  })

  const toolUseEvent = (name, id, input, ts) => ({
    type: 'assistant',
    subtype: 'tool_use',
    content: name,
    tool_use_id: id,
    tool_input: input,
    ts: ts || new Date().toISOString(),
  })

  const toolResultEvent = (toolUseId, content, ts) => ({
    type: 'user',
    subtype: 'tool_result',
    content,
    tool_use_id: toolUseId,
    ts: ts || new Date().toISOString(),
  })

  const compactBoundaryEvent = (metadata = {}, ts) => ({
    type: 'system',
    subtype: 'compact_boundary',
    id: 'cb-1',
    message_data: { compact_metadata: metadata },
    ts: ts || new Date().toISOString(),
  })

  it('renders user message', () => {
    render(<Turn userMessage="Hello world" events={[]} />)

    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('parses slash commands in user message', () => {
    const xmlMessage = '<command-name>/help</command-name><command-args>topic</command-args>'
    render(<Turn userMessage={xmlMessage} events={[]} />)

    // Token + args render in adjacent spans now (SlashCommandToken).
    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('topic', { exact: false })).toBeInTheDocument()
  })

  it('renders text blocks as Markdown', () => {
    const events = [textEvent('Some **text**')]

    render(<Turn events={events} />)

    expect(screen.getByTestId('markdown')).toHaveTextContent('Some **text**')
  })

  it('renders ThinkingBlock for thinking events', () => {
    const events = [thinkingEvent('Thinking content')]

    render(<Turn events={events} />)

    // Real ThinkingBlock renders "Thinking" label and content
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByText('Thinking content')).toBeInTheDocument()
  })

  it('renders ToolBlock for tool events', () => {
    const events = [
      toolUseEvent('Bash', 'tu-1', { command: 'ls' }),
      toolResultEvent('tu-1', 'output'),
    ]

    render(<Turn events={events} />)

    expect(screen.getByTestId('tool-block')).toHaveTextContent('Bash')
  })

  it('renders CompactionBlock for compaction events', () => {
    const events = [compactBoundaryEvent({ trigger: 'auto', pre_tokens: 50000 })]

    render(<Turn events={events} />)

    // Real CompactionBlock renders "Conversation compacted" with token count
    expect(screen.getByText('Conversation compacted')).toBeInTheDocument()
    expect(screen.getByText(/50K tokens/)).toBeInTheDocument()
  })

  it('shows "Working..." indicator when isActive=true', () => {
    render(<Turn events={[]} isActive={true} showProgress={true} />)

    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getByText('◐')).toBeInTheDocument()
  })

  it('shows "Stopping..." when isStopping=true', () => {
    render(<Turn events={[]} isStopping={true} showProgress={true} />)

    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  it('shows completed duration when turn ends', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const events = [
      textEvent('Response start', new Date(now - 5000).toISOString()),
      textEvent('Response end', new Date(now).toISOString()),
    ]

    render(<Turn events={events} isActive={false} />)

    expect(screen.getByText(/worked for/)).toBeInTheDocument()
  })

  it('applies error styling when resultStatus="error"', () => {
    const events = [textEvent('Error msg')]

    render(<Turn events={events} resultStatus="error" />)

    expect(document.querySelector('.turn-error')).toBeInTheDocument()
  })

  it('applies pending styling when pending=true', () => {
    render(<Turn userMessage="Pending message" events={[]} pending={true} />)

    const container = document.querySelector('.turn-container.pending')
    expect(container).toBeInTheDocument()
  })

  it('handles empty events gracefully', () => {
    render(<Turn userMessage="Hello" events={[]} />)

    expect(screen.getByText('Hello')).toBeInTheDocument()
  })

  it('wraps content in .turn-container so the content-visibility CSS rule applies', () => {
    // The lazy-paint claim is enforced in CSS on .turn-container - verify
    // the wrapper class is on the rendered output so the stylesheet hits.
    render(<Turn userMessage="hi" events={[]} />)
    expect(document.querySelector('.turn-container')).toBeInTheDocument()
  })

  it('renders user bubble for image-only attachment without text', () => {
    const attachments = [{ filename: 'photo.png', media_type: 'image/png' }]

    render(<Turn userMessage="" attachments={attachments} events={[]} />)

    expect(screen.getByTestId('message-user')).toBeInTheDocument()
  })

  it('does not render user bubble when no message and no attachments', () => {
    render(<Turn userMessage="" events={[]} />)

    expect(screen.queryByTestId('message-user')).not.toBeInTheDocument()
  })

  describe('collapse/expand toggle', () => {
    const makeCompletedTurnEvents = () => {
      const now = Date.now()
      vi.setSystemTime(now)
      return [
        textEvent('Response text', new Date(now - 5000).toISOString()),
        textEvent('More text', new Date(now).toISOString()),
      ]
    }

    it('collapses turn content when meta header is clicked', () => {
      const events = makeCompletedTurnEvents()

      render(<Turn events={events} isActive={false} />)

      const meta = document.querySelector('.turn-meta')
      fireEvent.click(meta)

      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')
    })

    it('expands turn content when collapsed meta is clicked again', () => {
      const events = makeCompletedTurnEvents()

      render(<Turn events={events} isActive={false} />)

      const meta = document.querySelector('.turn-meta')
      fireEvent.click(meta)
      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')

      fireEvent.click(meta)
      expect(document.querySelector('.turn-content')).not.toHaveClass('turn-content-collapsed')
    })

    it('starts collapsed when defaultCollapsed is true', () => {
      const events = makeCompletedTurnEvents()

      render(<Turn events={events} isActive={false} defaultCollapsed={true} />)

      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')
    })

    it('does not allow collapsing active turns', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const events = [
        textEvent('Active response', new Date(now - 5000).toISOString()),
        textEvent('Still going', new Date(now).toISOString()),
      ]

      render(<Turn events={events} isActive={true} showProgress={true} />)

      const meta = document.querySelector('.turn-meta')
      expect(meta).not.toHaveClass('turn-meta-collapsible')
    })
  })

  describe('central collapse via context', () => {
    const makeCompletedTurnEvents = () => {
      const now = Date.now()
      vi.setSystemTime(now)
      return [
        textEvent('Response text', new Date(now - 5000).toISOString()),
        textEvent('More text', new Date(now).toISOString()),
      ]
    }

    it('derives collapsed from the central set when a provider is present', () => {
      const events = makeCompletedTurnEvents()

      render(
        <TurnCollapseProvider collapsedTurnIds={new Set(['t1'])} onToggleTurnCollapse={vi.fn()}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnCollapseProvider>,
      )

      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')
    })

    it('stays expanded when its turn id is not in the central set', () => {
      const events = makeCompletedTurnEvents()

      render(
        <TurnCollapseProvider collapsedTurnIds={new Set(['other'])} onToggleTurnCollapse={vi.fn()}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnCollapseProvider>,
      )

      expect(document.querySelector('.turn-content')).not.toHaveClass('turn-content-collapsed')
    })

    it('meta-row click calls the central per-turn toggle with its turn id', () => {
      const onToggleTurnCollapse = vi.fn()
      const events = makeCompletedTurnEvents()

      render(
        <TurnCollapseProvider
          collapsedTurnIds={new Set()}
          onToggleTurnCollapse={onToggleTurnCollapse}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnCollapseProvider>,
      )

      fireEvent.click(document.querySelector('.turn-meta'))

      expect(onToggleTurnCollapse).toHaveBeenCalledWith('t1')
    })
  })

  describe('interrupt indicator', () => {
    it('suppresses interrupt ack events without rendering content', () => {
      // Interrupt ack events are SDK internal noise - suppressed entirely
      const events = [
        {
          type: 'user',
          subtype: 'text',
          is_human: false,
          content: '[Interrupted by user]',
          ts: new Date().toISOString(),
        },
      ]

      const { container } = render(<Turn events={events} />)

      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument()
      expect(container.querySelector('.interrupt-indicator')).not.toBeInTheDocument()
    })

    it('applies turn-interrupted class when interrupted prop is true', () => {
      const events = [textEvent('Msg')]

      render(<Turn events={events} interrupted={true} />)

      expect(document.querySelector('.turn-interrupted')).toBeInTheDocument()
    })
  })

  describe('copy button', () => {
    it('renders copy button on user message', () => {
      render(<Turn userMessage="Hello world" events={[]} />)

      // Real CopyButton renders with title attribute
      expect(screen.getByTitle('Copy message')).toBeInTheDocument()
    })

    it('renders turn copy button when expanded and has text content', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const events = [
        textEvent('Response text', new Date(now - 5000).toISOString()),
        textEvent('More text', new Date(now).toISOString()),
      ]

      render(<Turn events={events} isActive={false} />)

      expect(screen.getByTitle('Copy turn')).toBeInTheDocument()
    })
  })

  describe('completion footer', () => {
    it('shows completion footer with duration when turn finishes', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const events = [
        textEvent('Done', new Date(now - 10000).toISOString()),
        textEvent('Final', new Date(now).toISOString()),
      ]

      render(<Turn events={events} isActive={false} hasNextUserMessage={true} />)

      const footer = document.querySelector('.turn-progress-complete')
      expect(footer).toBeInTheDocument()
      expect(screen.getByText(/worked for/)).toBeInTheDocument()
    })

    it('does not show completion footer when turn is active', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const events = [
        textEvent('Still going', new Date(now - 5000).toISOString()),
        textEvent('More', new Date(now).toISOString()),
      ]

      render(<Turn events={events} isActive={true} showProgress={true} />)

      const footer = document.querySelector('.turn-progress-complete')
      expect(footer).not.toBeInTheDocument()
    })
  })

  describe('local command output in text blocks', () => {
    it('renders LocalCommandBlock when entire text is wrapped in stdout tag', () => {
      const content = '<local-command-stdout>output here</local-command-stdout>'
      const events = [textEvent(content)]

      render(<Turn events={events} />)

      expect(screen.getByText('stdout')).toBeInTheDocument()
      expect(screen.getByText('output here')).toBeInTheDocument()
    })

    it('renders LocalCommandBlock when entire text is wrapped in stderr tag', () => {
      const content = '<local-command-stderr>error output</local-command-stderr>'
      const events = [textEvent(content)]

      render(<Turn events={events} />)

      expect(screen.getByText('stderr')).toBeInTheDocument()
      expect(screen.getByText('error output')).toBeInTheDocument()
    })

    it('renders through Markdown when command tag is not full-wrap', () => {
      const content = 'Text before <local-command-stdout>output</local-command-stdout> after'
      const events = [textEvent(content)]

      render(<Turn events={events} />)

      expect(screen.getByTestId('markdown')).toBeInTheDocument()
      expect(screen.queryByText('stdout')).not.toBeInTheDocument()
    })

    it('renders plain text blocks through Markdown as before', () => {
      const events = [textEvent('No command tags here')]

      render(<Turn events={events} />)

      expect(screen.getByTestId('markdown')).toHaveTextContent('No command tags here')
      expect(screen.queryByText('stdout')).not.toBeInTheDocument()
      expect(screen.queryByText('stderr')).not.toBeInTheDocument()
    })
  })

  describe('live ticking duration', () => {
    it('updates duration every second when active', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const events = [
        textEvent('Working', new Date(now - 3000).toISOString()),
        textEvent('More', new Date(now).toISOString()),
      ]

      render(<Turn events={events} isActive={true} showProgress={true} />)

      const durationEl = document.querySelector('.turn-duration')
      expect(durationEl).toBeInTheDocument()
      const initialText = durationEl.textContent

      act(() => {
        vi.advanceTimersByTime(2000)
      })

      expect(durationEl.textContent).not.toBe(initialText)
    })
  })

  describe('forking state', () => {
    it('applies forking class to user message when forking=true', () => {
      render(<Turn userMessage="Hello" events={[]} forking={true} />)

      const userMsg = document.querySelector('.chat-message-user')
      expect(userMsg).toHaveClass('forking')
    })

    it('does not apply forking class when forking=false', () => {
      render(<Turn userMessage="Hello" events={[]} forking={false} />)

      const userMsg = document.querySelector('.chat-message-user')
      expect(userMsg).not.toHaveClass('forking')
    })
  })

  describe('AskUserQuestion deduplication via prop', () => {
    const questions = [{ question: 'Pick color?', options: ['red', 'blue'] }]

    it('hides tool blocks whose IDs are in duplicateAskUserIds', () => {
      const events = [
        toolUseEvent('AskUserQuestion', 'tu-ask-1', { questions }),
        toolResultEvent('tu-ask-1', 'Answer questions?'),
        toolUseEvent('AskUserQuestion', 'tu-ask-2', { questions }),
        toolResultEvent('tu-ask-2', 'Answer questions?'),
      ]

      render(<Turn events={events} duplicateAskUserIds={new Set(['tu-ask-1'])} />)

      const toolBlocks = screen.getAllByTestId('tool-block')
      expect(toolBlocks).toHaveLength(1)
      expect(toolBlocks[0]).toHaveAttribute('data-tool-use-id', 'tu-ask-2')
    })

    it('shows all blocks when duplicateAskUserIds is null', () => {
      const events = [
        toolUseEvent('AskUserQuestion', 'tu-ask-1', { questions }),
        toolResultEvent('tu-ask-1', 'ok'),
        toolUseEvent('AskUserQuestion', 'tu-ask-2', { questions }),
        toolResultEvent('tu-ask-2', 'ok'),
      ]

      render(<Turn events={events} duplicateAskUserIds={null} />)

      const toolBlocks = screen.getAllByTestId('tool-block')
      expect(toolBlocks).toHaveLength(2)
    })

    it('does not affect non-AskUserQuestion tool blocks', () => {
      const events = [
        toolUseEvent('Bash', 'tu-1', { command: 'ls' }),
        toolResultEvent('tu-1', 'output'),
        toolUseEvent('Bash', 'tu-2', { command: 'ls' }),
        toolResultEvent('tu-2', 'output'),
      ]

      render(<Turn events={events} duplicateAskUserIds={new Set()} />)

      const toolBlocks = screen.getAllByTestId('tool-block')
      expect(toolBlocks).toHaveLength(2)
    })
  })
})
