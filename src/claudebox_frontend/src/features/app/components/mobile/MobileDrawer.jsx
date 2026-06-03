/** Left slide-in navigation drawer for session management on mobile. */

import { Plus, X } from 'lucide-react'
import { useCallback } from 'react'
import { deleteContainer } from '../../../../api/containers'
import { updateSession } from '../../../../api/sessions'
import { useContainerMap } from '../../../../context/ContainerMapContext'
import { useEvents } from '../../../../context/EventsContext'
import { useSessionData } from '../../../../context/SessionDataContext'
import { useSessionRouting } from '../../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../../context/SessionsContext'
import { useWorkspace } from '../../../../context/WorkspaceContext'
import useNewSession from '../../../../hooks/useNewSession'
import { resolveContainerId } from '../../../../utils/containerLookup'
import SessionItem from '../../../sessions/components/session-tree/components/SessionItem'

/**
 * Mobile left slide-in drawer.
 *
 * @param {object} props
 * @param {Function} props.onClose - Close the drawer.
 */
export default function MobileDrawer({ onClose }) {
  const { sessions, refresh: refreshSessions } = useSessionsList()
  const { sessionId: currentSessionId } = useSessionData()
  const { workspaceId, workspaces, selectWorkspace } = useWorkspace()
  const { navigateToSession, navigateToWorkspace } = useSessionRouting()
  const { containerMap, addStoppingSession, removeSessionContainer } = useContainerMap()
  const { isConnected } = useEvents()
  const { executeNewSession, isCreating } = useNewSession()

  const handleSelectSession = useCallback(
    sessionId => {
      if (workspaceId) {
        navigateToSession(workspaceId, sessionId)
      }
      onClose()
    },
    [workspaceId, navigateToSession, onClose],
  )

  const handleRenameSession = useCallback(
    async (sessionId, name) => {
      try {
        await updateSession(sessionId, { name })
        void refreshSessions()
      } catch (err) {
        console.debug('MobileDrawer: updateSession failed', err)
      }
    },
    [refreshSessions],
  )

  const handleNewSession = useCallback(() => {
    executeNewSession()
    onClose()
  }, [executeNewSession, onClose])

  const handleSwitchWorkspace = useCallback(
    id => {
      if (id !== workspaceId) {
        selectWorkspace(id)
        navigateToWorkspace(id)
      }
      onClose()
    },
    [workspaceId, selectWorkspace, navigateToWorkspace, onClose],
  )

  const handleCloseSession = useCallback(() => {
    if (!currentSessionId) {
      return
    }
    const containerId = resolveContainerId(currentSessionId, containerMap, sessions)
    if (containerId) {
      addStoppingSession(currentSessionId)
      deleteContainer(containerId).catch(err =>
        console.debug('MobileDrawer: deleteContainer failed', err),
      )
      removeSessionContainer(currentSessionId)
    }
    onClose()
  }, [
    currentSessionId,
    containerMap,
    sessions,
    addStoppingSession,
    removeSessionContainer,
    onClose,
  ])

  return (
    <div className="mobile-drawer-overlay" onClick={onClose}>
      <div className="mobile-drawer" onClick={e => e.stopPropagation()}>
        <button type="button" className="mobile-drawer-close" onClick={onClose} title="Close menu">
          <X size={18} />
        </button>
        {workspaces.length > 1 && (
          <div className="mobile-drawer-workspaces">
            <span className="mobile-drawer-label">Workspaces</span>
            {workspaces.map(w => (
              <button
                key={w.id}
                type="button"
                className={`mobile-drawer-ws-item${w.id === workspaceId ? ' active' : ''}`}
                onClick={() => handleSwitchWorkspace(w.id)}>
                {w.id}
              </button>
            ))}
          </div>
        )}
        <div className="mobile-drawer-divider" />
        <button
          type="button"
          className="mobile-drawer-new-session"
          onClick={handleNewSession}
          disabled={isCreating}>
          <Plus size={14} />
          New session
        </button>
        <div className="mobile-drawer-divider" />
        <div className="mobile-drawer-sessions">
          {sessions.map(s => (
            <SessionItem
              key={s.session_id}
              isMobile
              session={s}
              isCurrent={s.session_id === currentSessionId}
              isPinned={false}
              onResume={() => handleSelectSession(s.session_id)}
              onRename={name => handleRenameSession(s.session_id, name)}
              onClose={onClose}
            />
          ))}
        </div>
        <div className="mobile-drawer-divider" />
        <button
          type="button"
          className="mobile-drawer-close-session"
          onClick={handleCloseSession}
          disabled={!(currentSessionId && isConnected)}>
          <X size={14} />
          Close session
        </button>
      </div>
    </div>
  )
}
