/** Tests for QueuedMessageBubble component. */

import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./turn/components/user-message-content', () => ({
  default: ({ message }) => <div data-testid="user-content">{message}</div>,
}))
vi.mock('../../../config/schema', () => ({ QueueStatus: { PAUSED: 'paused', QUEUED: 'queued' } }))

import QueuedMessageBubble from './QueuedMessageBubble'

const makeItem = (status = 'queued') => ({
  id: 'item-1',
  status,
  content: 'Hello world',
  attachments: [],
})

const makeHandlers = () => ({
  onEdit: vi.fn(),
  onCancel: vi.fn(),
  onRequeue: vi.fn(),
  onSendNow: vi.fn(),
})

describe('QueuedMessageBubble', () => {
  it('queued item shows Send now, Edit, Cancel buttons and no paused class', () => {
    const { getByTitle, queryByTitle, getByTestId } = render(
      <QueuedMessageBubble item={makeItem('queued')} {...makeHandlers()} />,
    )
    expect(getByTitle('Send now')).toBeDefined()
    expect(getByTitle('Edit')).toBeDefined()
    expect(getByTitle('Cancel')).toBeDefined()
    expect(queryByTitle('Re-queue')).toBeNull()
    expect(getByTestId('queued-message-bubble').className).not.toContain('paused')
  })

  it('paused item shows Re-queue, Cancel buttons and has paused class', () => {
    const { getByTitle, queryByTitle, getByTestId } = render(
      <QueuedMessageBubble item={makeItem('paused')} {...makeHandlers()} />,
    )
    expect(getByTitle('Re-queue')).toBeDefined()
    expect(getByTitle('Cancel')).toBeDefined()
    expect(queryByTitle('Send now')).toBeNull()
    expect(queryByTitle('Edit')).toBeNull()
    expect(getByTestId('queued-message-bubble').className).toContain('paused')
  })

  it('Send now calls onSendNow with item id', () => {
    const handlers = makeHandlers()
    const { getByTitle } = render(<QueuedMessageBubble item={makeItem('queued')} {...handlers} />)
    fireEvent.click(getByTitle('Send now'))
    expect(handlers.onSendNow).toHaveBeenCalledWith('item-1')
  })

  it('Edit calls onEdit with item id', () => {
    const handlers = makeHandlers()
    const { getByTitle } = render(<QueuedMessageBubble item={makeItem('queued')} {...handlers} />)
    fireEvent.click(getByTitle('Edit'))
    expect(handlers.onEdit).toHaveBeenCalledWith('item-1')
  })

  it('Cancel calls onCancel with item id', () => {
    const handlers = makeHandlers()
    const { getByTitle } = render(<QueuedMessageBubble item={makeItem('queued')} {...handlers} />)
    fireEvent.click(getByTitle('Cancel'))
    expect(handlers.onCancel).toHaveBeenCalledWith('item-1')
  })

  it('Re-queue calls onRequeue with item id', () => {
    const handlers = makeHandlers()
    const { getByTitle } = render(<QueuedMessageBubble item={makeItem('paused')} {...handlers} />)
    fireEvent.click(getByTitle('Re-queue'))
    expect(handlers.onRequeue).toHaveBeenCalledWith('item-1')
  })
})
