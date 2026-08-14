/** Context bridge - renders StillRunningToast when StillRunningToastContext has one. */

import { useStillRunningToast } from '../../../context/StillRunningToastContext'
import StillRunningToast from './StillRunningToast'

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
