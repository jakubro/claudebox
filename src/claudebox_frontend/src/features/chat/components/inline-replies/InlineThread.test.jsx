/** Tests for InlineThread - the reply box body: quote attribution + editable response field. */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BlockCollapseManager from '../chat-input/BlockCollapseManager'
import InlineThread from './InlineThread'

// useInteraction throws outside InteractionProvider - stub it so InlineThread's own interrupt
// handler can render standalone.
vi.mock('../../../../context/InteractionContext', () => ({
  useInteraction: () => ({
    interruptStatus: null,
    startInterrupt: vi.fn(),
    completeInterrupt: vi.fn(),
    setError: vi.fn(),
  }),
}))

// PromotedThreadCard's own fetch (railPromoted branch) - resolved per test, see that section.
vi.mock('../../../../api/sessions', () => ({
  getSessionEvents: vi.fn(),
}))

// The id counter is shared across manager instances (BlockCollapseManager.js); rewind it so
// each test's ids stay order-independent.
beforeEach(() => {
  BlockCollapseManager.resetGlobalCounterForTests()
})

function makeReply(overrides = {}) {
  return {
    id: 'r1',
    quote: 'quoted text',
    from: 'assistant',
    response: '',
    ...overrides,
  }
}

/** Stateful harness - a controlled reply box needs a real re-render loop to observe onEdit's effect and the selection-restore layout effect that follows it. */
function ControlledInlineThread({ initialResponse = '', replyOverrides = {}, ...props }) {
  const [response, setResponse] = useState(initialResponse)
  return (
    <InlineThread
      {...props}
      reply={{ ...makeReply(replyOverrides), response }}
      onEdit={(_id, value) => setResponse(value)}
      maxHeight={200}
    />
  )
}

describe('InlineThread - quote attribution', () => {
  it('renders the quoted text and source', () => {
    render(
      <InlineThread reply={makeReply({ quote: 'hello world', from: 'you' })} maxHeight={200} />,
    )

    expect(screen.getByText('hello world')).toBeInTheDocument()
    expect(screen.getByText('you')).toBeInTheDocument()
  })
})

describe('InlineThread - sent vs unsent rendering', () => {
  it('renders an editable textarea when unsent', () => {
    render(<InlineThread reply={makeReply({ response: 'draft' })} sent={false} maxHeight={200} />)

    expect(screen.getByTestId('inline-thread-input')).toBeInTheDocument()
  })

  it('renders read-only response text when sent, no textarea', () => {
    render(<InlineThread reply={makeReply({ response: 'final answer' })} sent maxHeight={200} />)

    expect(screen.queryByTestId('inline-thread-input')).not.toBeInTheDocument()
    expect(screen.getByText('final answer')).toBeInTheDocument()
  })
})

describe('InlineThread - editing', () => {
  it('calls onEdit with the reply id and new value on change', async () => {
    const user = userEvent.setup()
    const onEdit = vi.fn()
    render(<InlineThread reply={makeReply()} maxHeight={200} onEdit={onEdit} />)

    await user.type(screen.getByTestId('inline-thread-input'), 'x')

    expect(onEdit).toHaveBeenCalledWith('r1', 'x')
  })
})

describe('InlineThread - Enter submits, Shift+Enter does not', () => {
  it('Enter calls onSubmitThread with the reply id and current text', async () => {
    const user = userEvent.setup()
    const onSubmitThread = vi.fn()
    render(
      <InlineThread
        reply={makeReply({ response: 'why this branch?' })}
        maxHeight={200}
        onEdit={vi.fn()}
        onSubmitThread={onSubmitThread}
      />,
    )

    const input = screen.getByTestId('inline-thread-input')
    input.focus()
    await user.keyboard('{Enter}')

    expect(onSubmitThread).toHaveBeenCalledTimes(1)
    expect(onSubmitThread).toHaveBeenCalledWith('r1', 'why this branch?')
  })

  it('Shift+Enter does not call onSubmitThread', async () => {
    const user = userEvent.setup()
    const onSubmitThread = vi.fn()
    render(
      <InlineThread
        reply={makeReply()}
        maxHeight={200}
        onEdit={vi.fn()}
        onSubmitThread={onSubmitThread}
      />,
    )

    const input = screen.getByTestId('inline-thread-input')
    input.focus()
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(onSubmitThread).not.toHaveBeenCalled()
  })
})

describe('InlineThread - delete and close controls', () => {
  it('unsent with onRemove shows a delete button that calls onRemove(id)', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<InlineThread reply={makeReply()} sent={false} maxHeight={200} onRemove={onRemove} />)

    await user.click(screen.getByTestId('inline-thread-delete'))

    expect(onRemove).toHaveBeenCalledWith('r1')
  })

  it('sent thread never shows the delete button', () => {
    render(<InlineThread reply={makeReply()} sent maxHeight={200} onRemove={vi.fn()} />)

    expect(screen.queryByTestId('inline-thread-delete')).not.toBeInTheDocument()
  })

  it('pinned with onClose shows a close button that calls onClose(id)', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<InlineThread reply={makeReply()} maxHeight={200} pinned onClose={onClose} />)

    await user.click(screen.getByTestId('inline-thread-close'))

    expect(onClose).toHaveBeenCalledWith('r1')
  })

  it('unpinned shows no close button', () => {
    render(<InlineThread reply={makeReply()} maxHeight={200} pinned={false} onClose={vi.fn()} />)

    expect(screen.queryByTestId('inline-thread-close')).not.toBeInTheDocument()
  })
})

describe('InlineThread - focus behavior', () => {
  it('calls onFocus(id) when the reply field gains focus', async () => {
    const user = userEvent.setup()
    const onFocus = vi.fn()
    render(<InlineThread reply={makeReply()} maxHeight={200} onFocus={onFocus} />)

    await user.click(screen.getByTestId('inline-thread-input'))

    expect(onFocus).toHaveBeenCalledWith('r1')
  })

  it('autoFocus focuses the reply field on mount', () => {
    render(<InlineThread reply={makeReply()} maxHeight={200} autoFocus />)

    expect(screen.getByTestId('inline-thread-input')).toHaveFocus()
  })

  it('does not autofocus by default', () => {
    render(<InlineThread reply={makeReply()} maxHeight={200} />)

    expect(screen.getByTestId('inline-thread-input')).not.toHaveFocus()
  })
})

describe('InlineThread - shared text-editing keys', () => {
  it('Ctrl+, wraps the selection and restores the caret after the closing tag', () => {
    render(<ControlledInlineThread initialResponse="hello world" />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(6, 11) // "world"

    fireEvent.keyDown(input, { key: ',', ctrlKey: true })

    expect(input.value).toBe('hello <this>world</this>')
    expect(input.selectionStart).toBe(24)
    expect(input.selectionEnd).toBe(24)
  })

  it('Tab indents at the caret and restores the caret after the inserted spaces', () => {
    render(<ControlledInlineThread initialResponse="hello" />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(0, 0)

    fireEvent.keyDown(input, { key: 'Tab' })

    expect(input.value).toBe('  hello')
    expect(input.selectionStart).toBe(2)
  })

  it('Shift+Enter continues a list marker instead of submitting', () => {
    const onSubmitThread = vi.fn()
    render(<ControlledInlineThread initialResponse="- foo" onSubmitThread={onSubmitThread} />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(5, 5)

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(input.value).toBe('- foo\n- ')
    expect(onSubmitThread).not.toHaveBeenCalled()
  })

  it("Ctrl+' collapses and Ctrl+\\ expands a block back to the original text", () => {
    render(<ControlledInlineThread initialResponse="<div>hello</div>" />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(7, 7)

    fireEvent.keyDown(input, { key: "'", ctrlKey: true })
    expect(input.value).toBe('<div...1>')

    input.setSelectionRange(3, 3)
    fireEvent.keyDown(input, { key: '\\', ctrlKey: true })
    expect(input.value).toBe('<div>hello</div>')
  })

  it('an ordinary character is not intercepted - plain typing still works', async () => {
    const user = userEvent.setup()
    render(<ControlledInlineThread />)
    const input = screen.getByTestId('inline-thread-input')

    await user.click(input)
    await user.keyboard('a')

    expect(input.value).toBe('a')
  })

  it('a leading slash types as plain text - no command autocomplete wiring exists here', async () => {
    const user = userEvent.setup()
    render(<ControlledInlineThread />)
    const input = screen.getByTestId('inline-thread-input')

    await user.click(input)
    await user.keyboard('/greet')

    expect(input.value).toBe('/greet')
    expect(document.querySelector('.command-autocomplete')).toBeNull()
  })

  it('arrow keys move the caret; nothing loads message history', () => {
    render(<ControlledInlineThread initialResponse="hello" />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(5, 5)

    fireEvent.keyDown(input, { key: 'ArrowUp' })

    expect(input.value).toBe('hello')
  })
})

describe('InlineThread - collapsed block expands before send', () => {
  it('sends the full expanded text, never the placeholder, then clears the field', () => {
    const onSubmitThread = vi.fn()
    render(
      <ControlledInlineThread initialResponse="<div>hello</div>" onSubmitThread={onSubmitThread} />,
    )
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(7, 7)

    fireEvent.keyDown(input, { key: "'", ctrlKey: true })
    expect(input.value).toBe('<div...1>')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onSubmitThread).toHaveBeenCalledWith('r1', '<div>hello</div>')
    // The field clears after send - the sent text now lives in thread.history, not the composer.
    expect(input.value).toBe('')
  })
})

describe('InlineThread - collapse isolation between two boxes', () => {
  it('two reply boxes open at once collapse independently', () => {
    render(
      <>
        <ControlledInlineThread initialResponse="<div>a</div>" replyOverrides={{ id: 'a' }} />
        <ControlledInlineThread initialResponse="<div>b</div>" replyOverrides={{ id: 'b' }} />
      </>,
    )
    const [inputA, inputB] = screen.getAllByTestId('inline-thread-input')
    inputA.setSelectionRange(7, 7)

    fireEvent.keyDown(inputA, { key: "'", ctrlKey: true })

    // Collapsing box A leaves box B untouched: the shared counter keeps ids unique, but each
    // manager's own map only knows the block it collapsed.
    expect(inputA.value).toBe('<div...1>')
    expect(inputB.value).toBe('<div>b</div>')
  })
})

describe('InlineThread - Ctrl+. interrupt', () => {
  it('is inert when canInterrupt is not passed (composer parity - disabled by default)', () => {
    render(<ControlledInlineThread />)
    const input = screen.getByTestId('inline-thread-input')

    // Beyond "does not throw": startInterrupt wiring is covered in useTextEditingKeys.test.js;
    // this just proves the key doesn't crash or type.
    fireEvent.keyDown(input, { key: '.', ctrlKey: true })

    expect(input.value).toBe('')
  })
})

describe('InlineThread - thread mode (asked in its own float)', () => {
  const thread = {
    sessionId: 'side-1',
    history: [{ question: 'why this branch?', answer: 'because it handles the edge case' }],
    running: false,
    error: null,
  }

  it('renders the question/answer history instead of the composer or read-only div', () => {
    render(<InlineThread reply={makeReply()} thread={thread} maxHeight={200} onEdit={vi.fn()} />)

    expect(screen.getByText('why this branch?')).toBeInTheDocument()
    expect(screen.getByText('because it handles the edge case')).toBeInTheDocument()
    expect(screen.getByTestId('inline-thread-input')).toBeInTheDocument() // the follow-up field
  })

  it('hides the delete button once a reply has become a thread', () => {
    render(
      <InlineThread
        reply={makeReply()}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('inline-thread-delete')).not.toBeInTheDocument()
  })

  it('a running thread shows a working indicator, a stop button, and a field still open for a follow-up', () => {
    render(
      <InlineThread
        reply={makeReply()}
        thread={{ ...thread, running: true }}
        maxHeight={200}
        onEdit={vi.fn()}
        onInterruptThread={vi.fn()}
      />,
    )

    expect(screen.getByTestId('inline-thread-working')).toBeInTheDocument()
    expect(screen.getByTestId('inline-thread-stop')).toBeInTheDocument()
    expect(screen.getByTestId('inline-thread-input')).toBeEnabled()
  })

  it('a finished thread shows no stop button and an enabled follow-up field', () => {
    render(<InlineThread reply={makeReply()} thread={thread} maxHeight={200} onEdit={vi.fn()} />)

    expect(screen.queryByTestId('inline-thread-stop')).not.toBeInTheDocument()
    expect(screen.getByTestId('inline-thread-input')).toBeEnabled()
  })

  it('Enter in the follow-up field calls onSubmitThread with the typed text', async () => {
    const user = userEvent.setup()
    const onSubmitThread = vi.fn()
    render(
      <InlineThread
        reply={makeReply({ response: 'and this one?' })}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onSubmitThread={onSubmitThread}
      />,
    )

    screen.getByTestId('inline-thread-input').focus()
    await user.keyboard('{Enter}')

    expect(onSubmitThread).toHaveBeenCalledWith('r1', 'and this one?')
  })

  it('clicking stop calls onInterruptThread with the reply id', async () => {
    const user = userEvent.setup()
    const onInterruptThread = vi.fn()
    render(
      <InlineThread
        reply={makeReply()}
        thread={{ ...thread, running: true }}
        maxHeight={200}
        onEdit={vi.fn()}
        onInterruptThread={onInterruptThread}
      />,
    )

    await user.click(screen.getByTestId('inline-thread-stop'))

    expect(onInterruptThread).toHaveBeenCalledWith('r1')
  })

  it('shows a thread error alongside the history', () => {
    render(
      <InlineThread
        reply={makeReply()}
        thread={{ ...thread, error: 'The answer failed to arrive' }}
        maxHeight={200}
        onEdit={vi.fn()}
      />,
    )

    expect(screen.getByText('The answer failed to arrive')).toBeInTheDocument()
  })

  it('shows the promote control only once a conversation exists', () => {
    const { rerender } = render(
      <InlineThread reply={makeReply()} maxHeight={200} onEdit={vi.fn()} onPromote={vi.fn()} />,
    )
    expect(screen.queryByTestId('inline-thread-promote')).not.toBeInTheDocument()

    rerender(
      <InlineThread
        reply={makeReply()}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onPromote={vi.fn()}
      />,
    )
    expect(screen.getByTestId('inline-thread-promote')).toBeInTheDocument()
  })

  it('calls onPromote with the reply id when the promote control is clicked', async () => {
    const user = userEvent.setup()
    const onPromote = vi.fn().mockResolvedValue(undefined)
    render(
      <InlineThread
        reply={makeReply()}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onPromote={onPromote}
      />,
    )

    await user.click(screen.getByTestId('inline-thread-promote'))

    expect(onPromote).toHaveBeenCalledWith('r1')
  })
})

describe('InlineThread - promoted (frozen after promotion)', () => {
  const thread = {
    sessionId: 'side-1',
    history: [{ question: 'why this branch?', answer: 'because it handles the edge case' }],
    running: false,
    error: null,
  }

  it('renders the history read-only, with no reply field and no promote control', () => {
    render(
      <InlineThread
        reply={makeReply({ promotedSessionId: 'promoted-1' })}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onPromote={vi.fn()}
        workspaceId="ws-1"
      />,
    )

    expect(screen.getByText('why this branch?')).toBeInTheDocument()
    expect(screen.getByText('because it handles the edge case')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-thread-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inline-thread-promote')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inline-thread-stop')).not.toBeInTheDocument()
  })

  it('links to the promoted session', () => {
    render(
      <InlineThread
        reply={makeReply({ promotedSessionId: 'promoted-1' })}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        workspaceId="ws-1"
      />,
    )

    const link = screen.getByTestId('inline-thread-moved-link')
    expect(link).toHaveAttribute(
      'href',
      `${location.pathname}${location.search}#/workspaces/ws-1/sessions/promoted-1`,
    )
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('the delete button never shows on a promoted (or any threaded) reply', () => {
    render(
      <InlineThread
        reply={makeReply({ promotedSessionId: 'promoted-1' })}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        workspaceId="ws-1"
      />,
    )

    expect(screen.queryByTestId('inline-thread-delete')).not.toBeInTheDocument()
  })

  it('still shows the close button when pinned', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <InlineThread
        reply={makeReply({ promotedSessionId: 'promoted-1' })}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        pinned
        onClose={onClose}
        workspaceId="ws-1"
      />,
    )

    await user.click(screen.getByTestId('inline-thread-close'))

    expect(onClose).toHaveBeenCalledWith('r1')
  })
})

describe('InlineThread - promote to rail control', () => {
  const thread = {
    sessionId: 'side-1',
    history: [{ question: 'why this branch?', answer: 'because it handles the edge case' }],
    running: false,
    error: null,
  }

  it('shows the rail-promote control alongside the new-tab one, once a conversation exists', () => {
    const { rerender } = render(
      <InlineThread
        reply={makeReply()}
        maxHeight={200}
        onEdit={vi.fn()}
        onPromote={vi.fn()}
        onPromoteToRail={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('inline-thread-promote-rail')).not.toBeInTheDocument()

    rerender(
      <InlineThread
        reply={makeReply()}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onPromote={vi.fn()}
        onPromoteToRail={vi.fn()}
      />,
    )
    expect(screen.getByTestId('inline-thread-promote')).toBeInTheDocument()
    expect(screen.getByTestId('inline-thread-promote-rail')).toBeInTheDocument()
  })

  it('calls onPromoteToRail with the reply id when the rail-promote control is clicked', async () => {
    const user = userEvent.setup()
    const onPromoteToRail = vi.fn().mockResolvedValue(undefined)
    render(
      <InlineThread
        reply={makeReply()}
        thread={thread}
        maxHeight={200}
        onEdit={vi.fn()}
        onPromoteToRail={onPromoteToRail}
      />,
    )

    await user.click(screen.getByTestId('inline-thread-promote-rail'))

    expect(onPromoteToRail).toHaveBeenCalledWith('r1')
  })
})

describe('InlineThread - rail-promoted (read-only card)', () => {
  beforeEach(async () => {
    const { getSessionEvents } = await import('../../../../api/sessions')
    vi.mocked(getSessionEvents).mockResolvedValue({
      events: [
        { type: 'user', is_human: true, content: 'which seam exactly?' },
        { type: 'assistant', subtype: 'text', content: 'the one between branch 1 and branch 2' },
      ],
    })
  })

  it('renders the read-only card instead of the ordinary quote row - no button row, no textarea', async () => {
    render(
      <InlineThread
        reply={makeReply({ threadSessionId: 'side-1', railPromoted: true })}
        maxHeight={200}
        onEdit={vi.fn()}
        onFocusRailPromoted={vi.fn()}
      />,
    )

    expect(await screen.findByTestId('promoted-thread-card')).toBeInTheDocument()
    expect(screen.getByText('which seam exactly?')).toBeInTheDocument()
    expect(screen.getByText('the one between branch 1 and branch 2')).toBeInTheDocument()
    expect(screen.queryByTestId('inline-thread-input')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inline-thread-promote-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('inline-thread-delete')).not.toBeInTheDocument()
  })

  it('calls onFocusRailPromoted with the thread session id when the focus control is clicked', async () => {
    const user = userEvent.setup()
    const onFocusRailPromoted = vi.fn()
    render(
      <InlineThread
        reply={makeReply({ threadSessionId: 'side-1', railPromoted: true })}
        maxHeight={200}
        onEdit={vi.fn()}
        onFocusRailPromoted={onFocusRailPromoted}
      />,
    )

    await user.click(await screen.findByTestId('promoted-thread-focus'))

    expect(onFocusRailPromoted).toHaveBeenCalledWith('side-1')
  })
})
