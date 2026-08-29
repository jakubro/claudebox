/** Tests for ThreadFoldRow. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: [{ session_id: 'src-1', name: 'research' }] }),
}))

import ThreadFoldRow from './ThreadFoldRow'

describe('ThreadFoldRow', () => {
  it('names the source and counts the inherited turns, collapsed by default', () => {
    render(
      <ThreadFoldRow turnCount={18} sourceSessionId="src-1" expanded={false} onToggle={() => {}} />,
    )

    expect(screen.getByText('18 earlier turns from research')).toBeInTheDocument()
    expect(screen.getByTestId('thread-fold-row')).toHaveAttribute('aria-expanded', 'false')
  })

  it('uses singular "turn" for a single inherited turn', () => {
    render(
      <ThreadFoldRow turnCount={1} sourceSessionId="src-1" expanded={false} onToggle={() => {}} />,
    )

    expect(screen.getByText('1 earlier turn from research')).toBeInTheDocument()
  })

  it('falls back to the source id when the session is not in the fetched list', () => {
    render(
      <ThreadFoldRow
        turnCount={3}
        sourceSessionId="missing-session"
        expanded={false}
        onToggle={() => {}}
      />,
    )

    expect(screen.getByText('3 earlier turns from missing-session')).toBeInTheDocument()
  })

  it('reflects the expanded state via aria-expanded', () => {
    render(
      <ThreadFoldRow turnCount={5} sourceSessionId="src-1" expanded={true} onToggle={() => {}} />,
    )

    expect(screen.getByTestId('thread-fold-row')).toHaveAttribute('aria-expanded', 'true')
  })

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(
      <ThreadFoldRow turnCount={5} sourceSessionId="src-1" expanded={false} onToggle={onToggle} />,
    )

    await user.click(screen.getByTestId('thread-fold-row'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
