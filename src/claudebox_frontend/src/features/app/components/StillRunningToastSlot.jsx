/** Context bridge - renders StillRunningToast when StillRunningToastContext has one. */

import { useStillRunningToast } from '../../../context/StillRunningToastContext'
import StillRunningToast from './StillRunningToast'

/** Render the still-running toast when context has one; navigates back to the prior session. */
export default function StillRunningToastSlot() {
  const { toast, dismissStillRunningToast } = useStillRunningToast()
  if (!toast) {
    return null
  }
  return (
    <StillRunningToast
      previousSessionName={toast.sessionName}
      onReturn={() => {
        toast.onReturn?.()
        dismissStillRunningToast()
      }}
      onDismiss={dismissStillRunningToast}
    />
  )
}
