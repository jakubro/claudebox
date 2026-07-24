/** Chat input wrapper - welcome vs. active gating + the status-working class flip. */

import ChatInput from './chat-input'

/** No-op callback used for ChatInput action props in welcome state. */
const NOOP = () => {}

/**
 * Render the chat composer with welcome-state masking applied.
 *
 * On welcome (no active session), every interactive callback is replaced with
 * a no-op and `deferSend` routes to the welcome bridge so the first submitted
 * message buffers into the new-session bootstrap. On an active session, every
 * action prop forwards to the real ChatPanel handlers.
 *
 * @param {object} props
 * @param {boolean} props.isWelcome - True before any session attaches.
 * @param {object} props.state - Display state flags forwarded into ChatInput.
 * @param {boolean} props.state.isConnected - SSE connection state (ignored when welcome).
 * @param {boolean} props.state.canInterrupt - Show the interrupt control (ignored when welcome).
 * @param {boolean} props.state.isResponding - Agent is streaming (ignored when welcome).
 * @param {boolean} props.state.isAwaitingResponse - Reply not yet started.
 * @param {boolean} props.state.isSubmitting - Submit in flight.
 * @param {string|null} props.state.overlayMode - 'creating' | 'resuming' | null.
 * @param {boolean} props.state.hasEvents - Whether any events have arrived.
 * @param {object} props.actions - Active-session callbacks plus the welcome bridge.
 * @param {function} props.actions.send - Active-session send callback.
 * @param {function} props.actions.enqueueMessage - Active-session queue callback.
 * @param {function} props.actions.deferSend - Active-session defer callback.
 * @param {function} props.actions.onWelcomeDeferSend - Welcome-state bridge for first message.
 * @param {object} props.refs - Refs bundle forwarded to ChatInput.
 * @param {object} props.queueEdit - Queue-edit payload forwarded as-is.
 */
export default function ChatInputArea({ isWelcome, state, actions, refs, queueEdit }) {
  const { isConnected, canInterrupt, isResponding, isAwaitingResponse, isSubmitting, overlayMode } =
    state
  const workingClass =
    !isWelcome && (isResponding || isAwaitingResponse || isSubmitting) ? ' status-working' : ''

  return (
    <div className={`chat-input${workingClass}`}>
      <ChatInput
        isConnected={!isWelcome && isConnected}
        canInterrupt={!isWelcome && canInterrupt}
        isResponding={!isWelcome && isResponding}
        overlayMode={isWelcome ? 'creating' : overlayMode}
        refs={refs}
        hasEvents={!isWelcome && state.hasEvents}
        send={isWelcome ? NOOP : actions.send}
        enqueueMessage={isWelcome ? NOOP : actions.enqueueMessage}
        deferSend={isWelcome ? actions.onWelcomeDeferSend : actions.deferSend}
        hasBufferedReplies={isWelcome ? undefined : actions.hasBufferedReplies}
        queueEdit={queueEdit}
      />
    </div>
  )
}
