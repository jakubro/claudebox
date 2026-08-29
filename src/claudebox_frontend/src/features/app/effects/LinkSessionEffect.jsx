/** Bridge between a link's carried send messages and session creation. */

import { useEffect, useRef } from 'react'
import { useInteraction } from '../../../context/InteractionContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useStash } from '../../../context/StashContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import useNewSession from '../../../hooks/useNewSession'

/** Create a session from a link's carried `send` messages once its named workspace is active. */
export default function LinkSessionEffect() {
  const { activeWorkspaceId, sendMessages, consumeSendMessages } = useSessionRouting()
  const { workspaces, workspaceId, loading, selectWorkspace } = useWorkspace()
  const { executeNewSessionFromLink } = useNewSession()
  const { setPendingInsert } = useStash()
  const { setError } = useInteraction()
  const consumedRef = useRef(null)

  useEffect(() => {
    // Guard on the array reference, not the hash: consumeSendMessages() rewrites the hash
    // synchronously, so StrictMode's second invoke would already see the post-consume value.
    if (sendMessages.length === 0 || loading || consumedRef.current === sendMessages) {
      return
    }

    if (!workspaces.some(w => w.id === activeWorkspaceId)) {
      // Consume silently - creating here would land the session in whatever workspace is active.
      consumedRef.current = sendMessages
      consumeSendMessages()
      return
    }

    if (workspaceId !== activeWorkspaceId) {
      selectWorkspace(activeWorkspaceId)
      return
    }

    consumedRef.current = sendMessages
    consumeSendMessages()

    executeNewSessionFromLink(sendMessages).then(({ undeliveredMessages }) => {
      if (undeliveredMessages.length > 0) {
        setPendingInsert(undeliveredMessages.join('\n\n'))
        setError('Message not allowed by workspace settings')
      }
    })
  }, [
    sendMessages,
    loading,
    workspaces,
    activeWorkspaceId,
    workspaceId,
    selectWorkspace,
    consumeSendMessages,
    executeNewSessionFromLink,
    setPendingInsert,
    setError,
  ])

  return null
}
