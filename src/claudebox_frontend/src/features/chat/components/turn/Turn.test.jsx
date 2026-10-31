/** Tests for Turn. */

import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnRoutingMode } from '../../../../utils/eventProcessing'
import Turn from './Turn'
import { TurnCollapseProvider } from './TurnCollapseContext'
import { TurnRoutingContext } from './TurnRoutingContext'

let mockCapabilities = null

vi.mock('../../../../hooks/useCapabilities', () => ({
  default: () => ({ capabilities: mockCapabilities, runtimeName: null }),
}))

// Mock heavy external libraries only
vi.mock('../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

// SlashCommandToken hits SessionDataContext for command resolution; stub it to a plain span since
// this test renders Turn without a provider.
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

  const timedTextEvents = (spanMs = 5000) => {
    const now = Date.now()
    vi.setSystemTime(now)
    return [
      textEvent('Response text', new Date(now - spanMs).toISOString()),
      textEvent('More text', new Date(now).toISOString()),
    ]
  }

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

    // Token and args render in adjacent spans (SlashCommandToken).
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

  it('renders no assistant message wrapper when the only block is a hidden ToolSearch call', () => {
    const events = [
      toolUseEvent('ToolSearch', 'ts-1', { query: 'read' }),
      toolResultEvent('ts-1', '[]'),
    ]

    render(<Turn events={events} />)

    expect(screen.queryByTestId('message-assistant')).not.toBeInTheDocument()
  })

  it('frames the progress row of a live turn whose only call is an unanswered ToolSearch', () => {
    const events = [toolUseEvent('ToolSearch', 'ts-1', { query: 'select:WebFetch' })]

    render(<Turn userMessage="fetch it" events={events} isActive={true} showProgress={true} />)

    expect(screen.getByTestId('turn-progress-pending')).toHaveTextContent('Working')
    expect(screen.queryByTestId('message-assistant')).not.toBeInTheDocument()
  })

  it('renders the assistant message wrapper when a visible block accompanies a hidden ToolSearch call', () => {
    const events = [
      toolUseEvent('ToolSearch', 'ts-1', { query: 'read' }),
      toolResultEvent('ts-1', '[]'),
      textEvent('Found it'),
    ]

    render(<Turn events={events} />)

    expect(screen.getByTestId('message-assistant')).toBeInTheDocument()
    expect(screen.getByTestId('markdown')).toHaveTextContent('Found it')
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
    expect(
      screen.getByTestId('turn-progress-working').querySelector('svg.progress-spinner'),
    ).toBeInTheDocument()
  })

  it('shows the working ring beside "Compacting conversation" on a pending turn', () => {
    render(<Turn events={[]} pending={true} isCompacting={true} showProgress={true} />)

    const progress = screen.getByTestId('turn-progress-working')
    expect(progress).toHaveTextContent('Compacting conversation')
    expect(progress.querySelector('svg.progress-spinner')).toBeInTheDocument()
  })

  it('shows "Stopping..." when isStopping=true', () => {
    render(<Turn events={[]} isStopping={true} showProgress={true} />)

    expect(screen.getByText('Stopping')).toBeInTheDocument()
  })

  it('shows completed duration when turn ends', () => {
    const events = timedTextEvents()

    render(<Turn events={events} isActive={false} />)

    expect(screen.getByText(/worked for/)).toBeInTheDocument()
  })

  it('shows when a finished turn ended on hovering "worked for"', () => {
    const events = [
      textEvent('Response start', '2025-01-18T12:00:01Z'),
      textEvent('Response end', '2025-01-18T12:01:45Z'),
    ]

    render(<Turn events={events} isActive={false} />)

    expect(screen.getByText(/worked for/)).toHaveAttribute(
      'title',
      new Date('2025-01-18T12:01:45Z').toLocaleString(),
    )
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

  it('wraps content in .turn-container', () => {
    // The windowed list's row measurement and jump/bookmark lookups address a turn through this
    // wrapper, so its presence is load-bearing.
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
    it('collapses turn content when meta header is clicked', () => {
      const events = timedTextEvents()

      render(<Turn events={events} isActive={false} />)

      const meta = document.querySelector('.turn-meta')
      fireEvent.click(meta)

      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')
    })

    it('expands turn content when collapsed meta is clicked again', () => {
      const events = timedTextEvents()

      render(<Turn events={events} isActive={false} />)

      const meta = document.querySelector('.turn-meta')
      fireEvent.click(meta)
      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')

      fireEvent.click(meta)
      expect(document.querySelector('.turn-content')).not.toHaveClass('turn-content-collapsed')
    })

    it('starts collapsed when defaultCollapsed is true', () => {
      const events = timedTextEvents()

      render(<Turn events={events} isActive={false} defaultCollapsed={true} />)

      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')
    })

    it('does not allow collapsing active turns', () => {
      const events = timedTextEvents()

      render(<Turn events={events} isActive={true} showProgress={true} />)

      const meta = document.querySelector('.turn-meta')
      expect(meta).not.toHaveClass('turn-meta-collapsible')
    })
  })

  describe('central collapse via context', () => {
    it('derives collapsed from the central set when a provider is present', () => {
      const events = timedTextEvents()

      render(
        <TurnCollapseProvider collapsedTurnIds={new Set(['t1'])} onToggleTurnCollapse={vi.fn()}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnCollapseProvider>,
      )

      expect(document.querySelector('.turn-content')).toHaveClass('turn-content-collapsed')
    })

    it('stays expanded when its turn id is not in the central set', () => {
      const events = timedTextEvents()

      render(
        <TurnCollapseProvider collapsedTurnIds={new Set(['other'])} onToggleTurnCollapse={vi.fn()}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnCollapseProvider>,
      )

      expect(document.querySelector('.turn-content')).not.toHaveClass('turn-content-collapsed')
    })

    it('meta-row click calls the central per-turn toggle with its turn id', () => {
      const onToggleTurnCollapse = vi.fn()
      const events = timedTextEvents()

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

  describe('right-slot routing (TurnRoutingContext)', () => {
    it('hides all chrome for a Bash-only turn when the context value is true (legacy boolean)', () => {
      const events = [toolUseEvent('Bash', 'b1', { command: 'ls' })]

      render(
        <TurnRoutingContext.Provider value={true}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.queryByTestId('message-assistant')).toBeNull()
    })

    it('hides all chrome for a Bash-only turn when the context value is BASH_ONLY', () => {
      const events = [toolUseEvent('Bash', 'b1', { command: 'ls' })]

      render(
        <TurnRoutingContext.Provider value={TurnRoutingMode.BASH_ONLY}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.queryByTestId('message-assistant')).toBeNull()
    })

    it('renders the Bash block inline when the context value is false (default, no provider)', () => {
      const events = [toolUseEvent('Bash', 'b1', { command: 'ls' })]

      render(<Turn events={events} turnId="t1" isActive={false} />)

      expect(screen.getByTestId('message-assistant')).toBeInTheDocument()
    })

    it('keeps a non-Bash turn visible even when the context value is true', () => {
      const events = [textEvent('hello')]

      render(
        <TurnRoutingContext.Provider value={true}>
          <Turn events={events} turnId="t1" isActive={false} />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.getByTestId('message-assistant')).toBeInTheDocument()
    })
  })

  describe('framed progress row for an emptied turn (work view)', () => {
    it('renders a framed progress row and no .turn bubble for a live tool-only turn', () => {
      const events = [toolUseEvent('Edit', 'e1', { file_path: 'a.js' })]

      render(
        <TurnRoutingContext.Provider value={TurnRoutingMode.ALL_TOOLS}>
          <Turn
            userMessage="edit the file"
            events={events}
            turnId="t1"
            isActive={true}
            showProgress={true}
          />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.getByTestId('turn-progress-pending')).toHaveTextContent('Working')
      expect(screen.queryByTestId('message-assistant')).not.toBeInTheDocument()
      expect(document.querySelector('.turn')).not.toBeInTheDocument()
    })

    it('removes the framed row on completion without touching the user message', () => {
      const events = [toolUseEvent('Edit', 'e1', { file_path: 'a.js' })]

      const { rerender } = render(
        <TurnRoutingContext.Provider value={TurnRoutingMode.ALL_TOOLS}>
          <Turn
            userMessage="edit the file"
            events={events}
            turnId="t1"
            isActive={true}
            showProgress={true}
          />
        </TurnRoutingContext.Provider>,
      )
      expect(screen.getByTestId('turn-progress-pending')).toBeInTheDocument()

      rerender(
        <TurnRoutingContext.Provider value={TurnRoutingMode.ALL_TOOLS}>
          <Turn
            userMessage="edit the file"
            events={events}
            turnId="t1"
            isActive={false}
            showProgress={false}
          />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.queryByTestId('turn-progress-pending')).not.toBeInTheDocument()
      expect(screen.queryByTestId('message-assistant')).not.toBeInTheDocument()
      expect(screen.getByTestId('message-user')).toBeInTheDocument()
      expect(screen.getByText('edit the file')).toBeInTheDocument()
    })

    it('renders the full bubble, not the framed row, once a tool call keeps something visible', () => {
      const events = [toolUseEvent('Edit', 'e1', { file_path: 'a.js' }), textEvent('done editing')]

      render(
        <TurnRoutingContext.Provider value={TurnRoutingMode.ALL_TOOLS}>
          <Turn events={events} turnId="t1" isActive={true} showProgress={true} />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.getByTestId('message-assistant')).toBeInTheDocument()
      expect(screen.queryByTestId('turn-progress-pending')).not.toBeInTheDocument()
    })
  })

  describe('framed progress row: tracks content, not acknowledgement', () => {
    it('renders a framed progress row for a pending turn with no content yet', () => {
      render(<Turn userMessage="fix the bug" events={[]} pending={true} showProgress={true} />)

      expect(screen.getByTestId('turn-progress-pending')).toBeInTheDocument()
      expect(screen.getByText('Working')).toBeInTheDocument()
    })

    it('keeps the frame for a live tool-only turn that has already started (not pending)', () => {
      const events = [toolUseEvent('Edit', 'e1', { file_path: 'a.js' })]

      render(
        <TurnRoutingContext.Provider value={TurnRoutingMode.ALL_TOOLS}>
          <Turn events={events} turnId="t1" isActive={true} showProgress={true} pending={false} />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.getByTestId('turn-progress-pending')).toHaveTextContent('Working')
      expect(screen.queryByTestId('message-assistant')).not.toBeInTheDocument()
    })

    it('shows no progress row for a pending turn once showProgress is false', () => {
      render(<Turn userMessage="fix the bug" events={[]} pending={true} showProgress={false} />)

      expect(screen.queryByTestId('turn-progress-pending')).not.toBeInTheDocument()
    })

    it('stays framed once acknowledged (not pending) but still has no content - the frame tracks content, not acknowledgement', () => {
      render(<Turn userMessage="fix the bug" events={[]} pending={false} showProgress={true} />)

      expect(screen.getByTestId('turn-progress-pending')).toBeInTheDocument()
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

      render(<Turn events={events} />)

      expect(screen.queryByText('Interrupted')).not.toBeInTheDocument()
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
      const events = timedTextEvents()

      render(<Turn events={events} isActive={false} />)

      expect(screen.getByTitle('Copy turn')).toBeInTheDocument()
    })
  })

  describe('completion footer', () => {
    it('shows completion footer with duration when turn finishes', () => {
      const events = timedTextEvents(10000)

      render(<Turn events={events} isActive={false} hasNextUserMessage={true} />)

      const footer = document.querySelector('.turn-progress-complete')
      expect(footer).toBeInTheDocument()
      expect(screen.getByText(/worked for/)).toBeInTheDocument()
    })

    it('marks a failed turn finished with a cross, not a check', () => {
      const now = Date.now()
      vi.setSystemTime(now)
      const events = [textEvent('Not logged in.', new Date(now).toISOString())]

      render(<Turn events={events} isActive={false} resultStatus="error" />)

      const footer = document.querySelector('.turn-progress-complete')
      expect(footer).toHaveTextContent('✗')
      expect(footer).not.toHaveTextContent('✓')
    })

    it('does not show completion footer when turn is active', () => {
      const events = timedTextEvents()

      render(<Turn events={events} isActive={true} showProgress={true} />)

      const footer = document.querySelector('.turn-progress-complete')
      expect(footer).not.toBeInTheDocument()
    })
  })

  describe('waiting on background work', () => {
    const waitingOn = [{ id: 'b1', name: 'Run the full gate' }]
    const finished = () => [
      textEvent('Final check running...', new Date(Date.now() - 5000).toISOString()),
    ]

    afterEach(() => {
      mockCapabilities = null
    })

    it('says what the finished turn waits on instead of its duration', () => {
      render(<Turn events={finished()} waitingOn={waitingOn} />)

      expect(screen.getByTestId('turn-progress-waiting')).toHaveTextContent(
        'Waiting on Run the full gate...',
      )
      expect(screen.queryByText(/worked for/)).not.toBeInTheDocument()
    })

    it('counts several tasks', () => {
      render(<Turn events={finished()} waitingOn={[...waitingOn, { id: 'a2', name: 'Review' }]} />)

      expect(screen.getByTestId('turn-progress-waiting')).toHaveTextContent(
        'Waiting on 2 background tasks...',
      )
    })

    it('shows Working rather than waiting while a turn runs', () => {
      render(<Turn events={finished()} isActive={true} showProgress={true} waitingOn={waitingOn} />)

      expect(screen.getByText('Working')).toBeInTheDocument()
      expect(screen.queryByTestId('turn-progress-waiting')).not.toBeInTheDocument()
    })

    it('yields to a queued message that has not started its turn', () => {
      render(<Turn events={finished()} hasPendingMessages={true} waitingOn={waitingOn} />)

      expect(screen.queryByTestId('turn-progress-waiting')).not.toBeInTheDocument()
    })

    it('frames the line for a turn whose blocks all moved to the right slot', () => {
      const events = [toolUseEvent('Edit', 'e1', { file_path: 'a.js' })]

      render(
        <TurnRoutingContext.Provider value={TurnRoutingMode.ALL_TOOLS}>
          <Turn userMessage="go" events={events} turnId="t1" waitingOn={waitingOn} />
        </TurnRoutingContext.Provider>,
      )

      expect(screen.getByTestId('turn-progress-pending')).toHaveTextContent('Waiting on')
    })

    it('shows for a runtime that reports no cost telemetry', () => {
      mockCapabilities = { supports_cost_telemetry: false }

      render(<Turn events={finished()} waitingOn={waitingOn} />)

      expect(screen.getByTestId('turn-progress-waiting')).toBeInTheDocument()
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
      const events = timedTextEvents(3000)

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

  describe('answer copy button', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const answerButton = () =>
      within(screen.getByTestId('message-assistant')).queryByTitle('Copy message')
    const finished = () => [
      textEvent('Let me check the parser first.', new Date(Date.now() - 180_000).toISOString()),
      toolUseEvent('Read', 'r1', { file_path: 'parser.py' }),
      toolResultEvent('r1', 'def parse(): ...'),
      textEvent('Final answer with **bold**.'),
    ]

    beforeEach(() => {
      writeText.mockClear()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })
    })

    afterEach(() => {
      mockCapabilities = null
    })

    it('copies only the last text block of a finished turn', async () => {
      render(<Turn events={finished()} />)

      await act(async () => fireEvent.click(answerButton()))

      expect(writeText).toHaveBeenCalledWith('Final answer with **bold**.')
      expect(answerButton().closest('.turn-progress-complete')).toHaveTextContent('worked for')
    })

    it('copies what Copy turn copies when the answer is the only text', async () => {
      render(<Turn events={[textEvent('Only this.')]} />)

      await act(async () => fireEvent.click(answerButton()))
      await act(async () => fireEvent.click(screen.getByTitle('Copy turn')))

      expect(writeText.mock.calls).toEqual([['Only this.'], ['Only this.']])
    })

    it('is absent while the turn works, when it holds no text, when collapsed or queued behind', () => {
      const cases = [
        { events: finished(), isActive: true, showProgress: true },
        { events: [toolUseEvent('Read', 'r1', { file_path: 'a.py' })] },
        { events: finished(), defaultCollapsed: true },
        { events: finished(), hasPendingMessages: true },
      ]

      for (const props of cases) {
        const { unmount } = render(<Turn {...props} />)
        expect(document.querySelector('.turn-answer-copy-btn')).not.toBeInTheDocument()
        unmount()
      }
    })

    it('sits in the cross row of a failed turn', () => {
      render(<Turn events={finished()} resultStatus="error" />)

      expect(answerButton().closest('.turn-progress-complete')).toHaveTextContent('✗')
    })

    it('keeps a row of its own for a runtime that reports no cost telemetry', () => {
      mockCapabilities = { supports_cost_telemetry: false }

      render(<Turn events={finished()} />)

      expect(answerButton().parentElement).toHaveClass('turn-progress')
      expect(screen.queryByText(/worked for/)).not.toBeInTheDocument()
    })

    it('sits at the end of the waiting row', () => {
      render(<Turn events={finished()} waitingOn={[{ id: 'b1', name: 'Run the gate' }]} />)

      expect(screen.getByTestId('turn-progress-waiting').lastElementChild).toBe(answerButton())
    })

    it('leaves the one-click replies as the last row of the turn', () => {
      render(<Turn events={finished()} replies={['Go', 'Hold']} onReply={vi.fn()} />)

      const content = screen.getByTestId('message-assistant').querySelector('.turn-content')
      expect(content.lastElementChild).toBe(screen.getByTestId('needs-user-replies'))
      expect(answerButton()).toBeInTheDocument()
    })
  })

  describe('needs-user replies', () => {
    it('renders the replies as the last element of the assistant message, the first as primary', () => {
      render(<Turn events={[textEvent('Approve?')]} replies={['Go', 'Hold']} onReply={vi.fn()} />)

      const content = screen.getByTestId('message-assistant').querySelector('.turn-content')
      const row = screen.getByTestId('needs-user-replies')
      expect(content.lastElementChild).toBe(row)
      const buttons = screen.getAllByRole('button', { name: /^(Go|Hold)$/ })
      expect(buttons.map(b => b.textContent)).toEqual(['Go', 'Hold'])
      expect(buttons[0]).toHaveClass('needs-user-reply-primary')
      expect(buttons[1]).not.toHaveClass('needs-user-reply-primary')
    })

    it('sends the clicked label and disables the row while it sends', async () => {
      let finish
      const onReply = vi.fn(() => new Promise(resolve => (finish = resolve)))
      render(<Turn events={[textEvent('Approve?')]} replies={['Go', 'Hold']} onReply={onReply} />)

      fireEvent.click(screen.getByRole('button', { name: 'Hold' }))

      expect(onReply).toHaveBeenCalledWith('Hold')
      expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled()
      await act(async () => finish())
      expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled()
    })

    it('renders no replies when none are offered', () => {
      render(<Turn events={[textEvent('Approve?')]} replies={null} onReply={vi.fn()} />)

      expect(screen.queryByTestId('needs-user-replies')).not.toBeInTheDocument()
    })
  })

  describe('user message timestamp', () => {
    it('shows when the message was sent, with the full time on hover', () => {
      vi.setSystemTime(new Date('2025-01-18T12:05:00Z'))
      render(<Turn userMessage="Hello" userMessageTime="2025-01-18T12:00:00Z" events={[]} />)

      const stamp = screen.getByTestId('message-user-timestamp')
      expect(stamp).toHaveTextContent('5m ago')
      expect(stamp).toHaveAttribute('title', new Date('2025-01-18T12:00:00Z').toLocaleString())
    })

    it('a finished turn keeps its timestamps up as time passes', () => {
      vi.setSystemTime(new Date('2025-01-18T12:00:00Z'))
      render(
        <Turn
          userMessage="Hello"
          userMessageTime="2025-01-18T12:00:00Z"
          events={[textEvent('Done', '2025-01-18T12:00:00Z')]}
        />,
      )

      act(() => vi.advanceTimersByTime(10 * 60_000))

      expect(screen.getByTestId('message-user-timestamp')).toHaveTextContent('10m ago')
      expect(document.querySelector('.turn-timestamp')).toHaveTextContent('10m ago')
    })

    it('shows no timestamp for a message not yet confirmed', () => {
      render(<Turn userMessage="Hello" events={[]} />)

      expect(screen.queryByTestId('message-user-timestamp')).not.toBeInTheDocument()
      expect(screen.getByTitle('Copy message')).toBeInTheDocument()
    })
  })
})
