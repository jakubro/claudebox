/** Tests for PromotedThreadCard - the rail-promoted quote's read-only hover card. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionEvents } from '../../../../api/sessions'
import PromotedThreadCard from './PromotedThreadCard'

vi.mock('../../../../api/sessions', () => ({
  getSessionEvents: vi.fn(),
}))

describe('PromotedThreadCard', () => {
  beforeEach(() => {
    vi.mocked(getSessionEvents).mockReset()
  })

  it('renders the quote immediately and the opening exchange once fetched', async () => {
    vi.mocked(getSessionEvents).mockResolvedValue({
      events: [
        { type: 'user', is_human: true, content: 'which seam exactly?' },
        { type: 'assistant', subtype: 'text', content: 'the one between branch 1 and branch 2' },
      ],
    })

    render(<PromotedThreadCard quote="the seam" threadSessionId="side-1" onFocus={vi.fn()} />)

    expect(screen.getByText('the seam')).toBeInTheDocument()
    expect(getSessionEvents).toHaveBeenCalledWith('side-1')

    expect(await screen.findByText('which seam exactly?')).toBeInTheDocument()
    expect(screen.getByText('the one between branch 1 and branch 2')).toBeInTheDocument()
  })

  it("shows the reader's own opening exchange, not what the thread inherited", async () => {
    vi.mocked(getSessionEvents).mockResolvedValue({
      events: [
        { type: 'user', is_human: true, content: 'inherited question' },
        { type: 'assistant', subtype: 'text', content: 'inherited answer' },
        {
          type: 'system',
          subtype: 'container_restarted',
          message_data: { fork_parent_session_id: 'source-session' },
        },
        { type: 'user', is_human: true, content: 'which seam exactly?' },
        { type: 'assistant', subtype: 'text', content: 'the one between branch 1 and branch 2' },
      ],
    })

    render(<PromotedThreadCard quote="the seam" threadSessionId="side-1" onFocus={vi.fn()} />)

    expect(await screen.findByText('which seam exactly?')).toBeInTheDocument()
    expect(screen.queryByText('inherited question')).not.toBeInTheDocument()
  })

  it('degrades to an empty opening exchange when the fetch fails, without throwing', async () => {
    vi.mocked(getSessionEvents).mockRejectedValue(new Error('gone'))

    render(<PromotedThreadCard quote="the seam" threadSessionId="side-1" onFocus={vi.fn()} />)

    expect(await screen.findByText('...')).toBeInTheDocument()
  })

  it('calls onFocus with the thread session id when the focus control is clicked', async () => {
    vi.mocked(getSessionEvents).mockResolvedValue({ events: [] })
    const user = userEvent.setup()
    const onFocus = vi.fn()

    render(<PromotedThreadCard quote="the seam" threadSessionId="side-1" onFocus={onFocus} />)

    await user.click(screen.getByTestId('promoted-thread-focus'))

    expect(onFocus).toHaveBeenCalledWith('side-1')
  })

  it('re-fetches when the thread session id changes', async () => {
    vi.mocked(getSessionEvents).mockResolvedValue({ events: [] })

    const { rerender } = render(
      <PromotedThreadCard quote="q1" threadSessionId="side-1" onFocus={vi.fn()} />,
    )
    await screen.findByText('...')

    rerender(<PromotedThreadCard quote="q2" threadSessionId="side-2" onFocus={vi.fn()} />)

    expect(getSessionEvents).toHaveBeenCalledWith('side-2')
  })
})
