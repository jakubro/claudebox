/** The card an agent's port request shows: approve or reject it, then what was chosen. */

import { useState } from 'react'
import { getAddressedSessionId } from '../../../../../../../api/apiClient'
import { answerPortRequest } from '../../../../../../../api/sessions'
import { ToolName } from '../../../../../../../config/schema'
import { parsePortAnswer } from '../../../../../../../utils/parsers'
import { useTurn } from '../../../hooks/useTurn'

const REFUSED = 'Not asked:'

/**
 * @param {string} props.toolName - The call's normalised tool name; only a port request shows a card
 * @param {number} props.port - The port inside the session the agent asked to open
 * @param {Object} [props.toolResult] - The request's result; a refused request shows no card
 */
export default function PortRequestCard({ toolName, port, toolResult }) {
  const { sessionId, nextUserMessage } = useTurn()
  const [chosen, setChosen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const answer = parsePortAnswer(nextUserMessage)
  const outcome = answer && answer.port === port ? answer.text : chosen

  const refused = toolResult?.is_error || String(toolResult?.content ?? '').startsWith(REFUSED)

  const validPort = Number.isInteger(port) && port >= 1 && port <= 65535

  if (toolName !== ToolName.PORT_OPEN || !validPort || refused) {
    return null
  }

  const choose = async approve => {
    setBusy(true)
    setFailure(null)
    try {
      const result = await answerPortRequest(sessionId ?? getAddressedSessionId(), port, approve)
      setChosen(
        result.address
          ? `Approved: port ${port} is reachable at ${result.address}.`
          : `Rejected: port ${port} stays closed.`,
      )
    } catch (error) {
      setFailure(error.userFacing ? error.message : 'The answer did not go through - try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="port-request" data-testid="port-request" data-port={port}>
      {outcome ? (
        <div className="port-request-outcome">{outcome}</div>
      ) : (
        <>
          <div className="port-request-question">Open port {port} to this computer?</div>
          <div className="port-request-actions">
            <button
              type="button"
              className="port-request-approve"
              disabled={busy}
              onClick={() => choose(true)}>
              Approve
            </button>
            <button
              type="button"
              className="port-request-reject"
              disabled={busy}
              onClick={() => choose(false)}>
              Reject
            </button>
          </div>
          {failure && <div className="port-request-error">{failure}</div>}
        </>
      )}
    </div>
  )
}
