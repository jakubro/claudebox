/** Bridge wiring InteractionContext.setError to SessionDataProvider.onError. */

import { useInteraction } from '../../../context/InteractionContext'
import { SessionDataProvider } from '../../../context/SessionDataContext'

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {Function} props.onSessionAttach - Fired with the active session id on change; binds the
 *   layout-save sessionId and triggers the per-session layout restore.
 */
export default function SessionDataBridge({ children, onSessionAttach }) {
  const { setError } = useInteraction()
  return (
    <SessionDataProvider onSessionAttach={onSessionAttach} onError={setError}>
      {children}
    </SessionDataProvider>
  )
}
