/** Tests for PortRequestCard. */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerPortRequest } from '../../../../../../../api/sessions'
import { TurnProvider } from '../../../TurnContext'
import PortRequestCard from './PortRequestCard'

vi.mock('../../../../../../../api/sessions', () => ({ answerPortRequest: vi.fn() }))

const PORT_OPEN = 'mcp__claudebox__port_open'

function renderCard(props, context = {}) {
  return render(
    <TurnProvider sessionId="s-1" nextUserMessage={null} {...context}>
      <PortRequestCard toolName={PORT_OPEN} port={8080} {...props} />
    </TurnProvider>,
  )
}

describe('PortRequestCard', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('asks to open the port with Approve and Reject', () => {
    renderCard({})

    expect(screen.getByText('Open port 8080 to this computer?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument()
  })

  it('approving sends the answer and shows the address with no buttons', async () => {
    answerPortRequest.mockResolvedValue({
      port: 8080,
      host_port: 18080,
      address: 'http://127.0.0.1:18080',
    })
    renderCard({})

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(
      await screen.findByText('Approved: port 8080 is reachable at http://127.0.0.1:18080.'),
    ).toBeInTheDocument()
    expect(answerPortRequest).toHaveBeenCalledWith('s-1', 8080, true)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('rejecting sends the answer and says the port stays closed', async () => {
    answerPortRequest.mockResolvedValue({ port: 8080, state: 'rejected' })
    renderCard({})

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(await screen.findByText('Rejected: port 8080 stays closed.')).toBeInTheDocument()
    expect(answerPortRequest).toHaveBeenCalledWith('s-1', 8080, false)
  })

  it('a failed answer keeps the buttons and says so', async () => {
    answerPortRequest.mockRejectedValue(new Error('no'))
    renderCard({})

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    expect(
      await screen.findByText('The answer did not go through - try again.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).not.toBeDisabled()
  })

  it('a refusal the reader can act on shows in its own words', async () => {
    const refusal = new Error('The session is not running. Resume it, then answer again.')
    refusal.userFacing = true
    answerPortRequest.mockRejectedValue(refusal)
    renderCard({})

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))

    expect(
      await screen.findByText('The session is not running. Resume it, then answer again.'),
    ).toBeInTheDocument()
  })

  it('shows the outcome the answer message carries after a reload', () => {
    renderCard(
      {},
      {
        nextUserMessage:
          '<response:port_open port="8080">Approved: port 8080 is reachable at http://127.0.0.1:8080.</response:port_open>',
      },
    )

    expect(
      screen.getByText('Approved: port 8080 is reachable at http://127.0.0.1:8080.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it.each([
    ['another tool', { toolName: 'Bash' }],
    [
      'a refused request',
      { toolResult: { content: 'Not asked: a reply thread cannot open a port.' } },
    ],
    ['no port', { port: undefined }],
    ['a port that is none', { port: 0 }],
    ['a call that failed', { toolResult: { content: 'Error: permission denied', is_error: true } }],
  ])('draws nothing for %s', (_name, props) => {
    const { container } = renderCard(props)

    expect(container).toBeEmptyDOMElement()
  })
})
