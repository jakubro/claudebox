/** Bridge wiring InteractionContext.setError to SessionDataProvider.onError. */

import { useInteraction } from '../../../context/InteractionContext'
import { SessionDataProvider } from '../../../context/SessionDataContext'

/**
 * Bridge wiring InteractionContext.setError to SessionDataProvider.onError.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {Function} props.onSessionAttach - Callback fired with the active session id whenever it changes; used to bind the layout-save sessionId and trigger the per-session layout restore.
 */
export default function SessionDataBridge({ children, onSessionAttach }) {
  const { setError } = useInteraction()
  return (
    <SessionDataProvider onSessionAttach={onSessionAttach} onError={setError}>
      {children}
    </SessionDataProvider>
  )
}
