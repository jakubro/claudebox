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
  it('Enter calls onSubmit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <InlineThread reply={makeReply()} maxHeight={200} onEdit={vi.fn()} onSubmit={onSubmit} />,
    )

    const input = screen.getByTestId('inline-thread-input')
    input.focus()
    await user.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter does not call onSubmit', async () => {
    const user = userEvent.setup()
    const onSubmit = vi.fn()
    render(
      <InlineThread reply={makeReply()} maxHeight={200} onEdit={vi.fn()} onSubmit={onSubmit} />,
    )

    const input = screen.getByTestId('inline-thread-input')
    input.focus()
    await user.keyboard('{Shift>}{Enter}{/Shift}')

    expect(onSubmit).not.toHaveBeenCalled()
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
    const onSubmit = vi.fn()
    render(<ControlledInlineThread initialResponse="- foo" onSubmit={onSubmit} />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(5, 5)

    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(input.value).toBe('- foo\n- ')
    expect(onSubmit).not.toHaveBeenCalled()
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
    await user.keyboard('/implement')

    expect(input.value).toBe('/implement')
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
  it('sends the full expanded text, never the placeholder', () => {
    const onSubmit = vi.fn()
    render(<ControlledInlineThread initialResponse="<div>hello</div>" onSubmit={onSubmit} />)
    const input = screen.getByTestId('inline-thread-input')
    input.setSelectionRange(7, 7)

    fireEvent.keyDown(input, { key: "'", ctrlKey: true })
    expect(input.value).toBe('<div...1>')

    fireEvent.keyDown(input, { key: 'Enter' })

    expect(input.value).toBe('<div>hello</div>')
    expect(onSubmit).toHaveBeenCalledTimes(1)
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
