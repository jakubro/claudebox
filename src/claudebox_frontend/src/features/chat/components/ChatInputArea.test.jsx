/** Tests for ChatInputArea - the composer's working-state class. */

import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./chat-input', () => ({ default: () => null }))

import ChatInputArea from './ChatInputArea'

const IDLE = {
  isConnected: true,
  canInterrupt: false,
  isResponding: false,
  isAwaitingResponse: false,
  isSubmitting: false,
  overlayMode: null,
  hasEvents: true,
}

function renderArea({ isWelcome = false, ...state } = {}) {
  const { container } = render(
    <ChatInputArea isWelcome={isWelcome} state={{ ...IDLE, ...state }} actions={{}} refs={{}} />,
  )
  return container.querySelector('.chat-input')
}

describe('ChatInputArea', () => {
  it('carries no working class while idle', () => {
    expect(renderArea()).not.toHaveClass('status-working')
  })

  it.each([
    ['responding', { isResponding: true }],
    ['awaiting the reply', { isAwaitingResponse: true }],
    ['submitting', { isSubmitting: true }],
  ])('marks the input working while %s', (_label, state) => {
    expect(renderArea(state)).toHaveClass('status-working')
  })

  it('never marks the welcome composer working', () => {
    expect(renderArea({ isWelcome: true, isResponding: true })).not.toHaveClass('status-working')
  })
})
