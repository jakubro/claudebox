/** Workspace switcher dropdown in the Dockview header tab bar. */

import { Check, ChevronDown, ExternalLink, Plus, Trash2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { deregisterWorkspace } from '../../../api/workspaces'
import { useEvents } from '../../../context/EventsContext'
import { useSessionData } from '../../../context/SessionDataContext'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { useStillRunningToast } from '../../../context/StillRunningToastContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import useDropdown from '../../../hooks/useDropdown'
import { openWorkspaceInNewTab } from '../../../utils/navigation'
import ConfirmDeregisterModal from './ConfirmDeregisterModal'
import RegisterWorkspaceModal from './RegisterWorkspaceModal'

/** Muted dark preset colors for the picker swatch + tab-bar gradient end-stop -
 * the favicon caller brightens them for visibility at favicon scale. */
const ACCENT_PALETTE = [
  '#1e3a5f',
  '#1a4a3a',
  '#4a1e4a',
  '#4a3520',
  '#2a4a2a',
  '#5a3020',
  '#2a2a5a',
  '#5a1e1e',
]

/** Workspace switcher dropdown for the session header strip. */
export default function WorkspaceSwitcher() {
  const { workspaces, workspaceId, selectWorkspace, refreshWorkspaces } = useWorkspace()
  const { navigateToSession, navigateToWorkspace } = useSessionRouting()
  const { workspaceColor, setWorkspaceColor } = useSessionsList()
  const { startOpeningWorkspace, clearOpeningWorkspace, isResponding } = useEvents()
  const { sessionId: currentSessionId, sessionName: currentSessionName } = useSessionData()
  const { showStillRunningToast } = useStillRunningToast()
  const { isOpen, setIsOpen, containerRef, handleToggle, handleKeyDown } = useDropdown(false)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [confirmDeregister, setConfirmDeregister] = useState(null)

  const openInNewTabWithStatus = useCallback(
    workspaceIdToOpen => {
      startOpeningWorkspace()
      requestAnimationFrame(() => {
        requestAnimationFrame(() => clearOpeningWorkspace())
      })
      openWorkspaceInNewTab(workspaceIdToOpen)
    },
    [startOpeningWorkspace, clearOpeningWorkspace],
  )

  const hasMultipleWorkspaces = workspaces.length > 1

  const handleSelect = useCallback(
    id => {
      setIsOpen(false)
      if (id === workspaceId) {
        return
      }
      // Snapshot the previous workspace's active session before we switch so
      // the still-running toast can return to it on click.
      const prevWorkspaceId = workspaceId
      const prevSessionId = currentSessionId
      const prevSessionName = currentSessionName
      const prevWasResponding = isResponding
      selectWorkspace(id)
      navigateToWorkspace(id)
      if (prevWasResponding && prevSessionId && prevWorkspaceId) {
        showStillRunningToast({
          sessionName: prevSessionName || prevSessionId.slice(0, 8),
          onReturn: () => navigateToSession(prevWorkspaceId, prevSessionId),
        })
      }
    },
    [
      workspaceId,
      currentSessionId,
      currentSessionName,
      isResponding,
      selectWorkspace,
      navigateToWorkspace,
      navigateToSession,
      showStillRunningToast,
      setIsOpen,
    ],
  )

  const handleColorSelect = useCallback(
    color => {
      setWorkspaceColor(color === workspaceColor ? null : color)
    },
    [workspaceColor, setWorkspaceColor],
  )

  const handleDeregisterConfirm = useCallback(async () => {
    if (!confirmDeregister) {
      return
    }
    try {
      await deregisterWorkspace(confirmDeregister.id)
    } catch (err) {
      console.debug('WorkspaceSwitcher: deregister failed', err)
    }
    setConfirmDeregister(null)
    await refreshWorkspaces()
  }, [confirmDeregister, refreshWorkspaces])

  const handleRegisterSuccess = useCallback(async () => {
    await refreshWorkspaces()
  }, [refreshWorkspaces])

  const currentWs = workspaces.find(w => w.id === workspaceId)
  const currentName = currentWs?.id || workspaceId || '-'
  const currentPath = currentWs?.path || currentName

  return (
    <span className="workspace-switcher" ref={containerRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        className="workspace-switcher-btn"
        onClick={handleToggle}
        title={`Workspace - ${currentPath}`}
        data-testid="workspace-switcher">
        {workspaceColor && (
          <span className="workspace-switcher-dot" style={{ background: workspaceColor }} />
        )}
        {currentName}
        <ChevronDown size={10} />
      </button>
      {isOpen && (
        <div className="workspace-switcher-dropdown" data-testid="workspace-switcher-dropdown">
          {hasMultipleWorkspaces && (
            <>
              {workspaces.map(w => (
                <button
                  key={w.id}
                  type="button"
                  className={`dropdown-option workspace-switcher-option${w.id === workspaceId ? ' selected' : ''}`}
                  onClick={e => {
                    if (e?.altKey) {
                      setIsOpen(false)
                      openInNewTabWithStatus(w.id)
                      return
                    }
                    handleSelect(w.id)
                  }}
                  onAuxClick={e => {
                    if (e.button === 1) {
                      e.preventDefault()
                      setIsOpen(false)
                      openInNewTabWithStatus(w.id)
                    }
                  }}>
                  <span className="workspace-switcher-check">
                    {w.id === workspaceId && <Check size={12} />}
                  </span>
                  <span className="workspace-switcher-name">{w.id}</span>
                  <span className="workspace-switcher-path">{w.path}</span>
                  {/* biome-ignore lint/a11y/useSemanticElements: span used because button cannot nest inside button */}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="workspace-switcher-newtab"
                    onClick={e => {
                      e.stopPropagation()
                      setIsOpen(false)
                      openInNewTabWithStatus(w.id)
                    }}
                    title="Open in new browser tab">
                    <ExternalLink size={10} />
                  </span>
                  {/* biome-ignore lint/a11y/useSemanticElements: span used because button cannot nest inside button */}
                  <span
                    role="button"
                    tabIndex={-1}
                    className="workspace-switcher-trash"
                    onClick={e => {
                      e.stopPropagation()
                      setIsOpen(false)
                      setConfirmDeregister(w)
                    }}
                    title="Deregister workspace"
                    data-testid={`workspace-switcher-trash-${w.id}`}>
                    <Trash2 size={10} />
                  </span>
                </button>
              ))}
              <div className="workspace-switcher-divider" />
            </>
          )}
          <div className="workspace-color-palette" data-testid="workspace-color-palette">
            {ACCENT_PALETTE.map(color => (
              <button
                key={color}
                type="button"
                className={`workspace-color-swatch${color === workspaceColor ? ' active' : ''}`}
                style={{ background: color }}
                onClick={() => handleColorSelect(color)}
              />
            ))}
            {workspaceColor && (
              <button
                type="button"
                className="workspace-color-swatch workspace-color-clear"
                onClick={() => setWorkspaceColor(null)}
                title="Clear color"
              />
            )}
          </div>
          <div className="workspace-switcher-divider" />
          <button
            type="button"
            className="dropdown-option workspace-switcher-register"
            onClick={() => {
              setIsOpen(false)
              setRegisterOpen(true)
            }}
            data-testid="workspace-switcher-register">
            <Plus size={12} />
            Register workspace…
          </button>
        </div>
      )}
      {registerOpen && (
        <RegisterWorkspaceModal
          onClose={() => setRegisterOpen(false)}
          onSuccess={handleRegisterSuccess}
        />
      )}
      {confirmDeregister && (
        <ConfirmDeregisterModal
          workspace={confirmDeregister}
          onConfirm={handleDeregisterConfirm}
          onCancel={() => setConfirmDeregister(null)}
        />
      )}
    </span>
  )
}
