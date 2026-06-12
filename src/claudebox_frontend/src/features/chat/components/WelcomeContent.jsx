/** Welcome content (workspace identity + keyboard shortcuts) shown when no session is active. */

import { useSessionsList } from '../../../context/SessionsContext'
import { useWorkspace } from '../../../context/WorkspaceContext'
import useIsMobile from '../../../hooks/useIsMobile'

/** Keyboard shortcut entries for the reference card. */
const SHORTCUTS = [
  { key: 'Alt+N', label: 'New session' },
  { key: 'Alt+Shift+N', label: 'New session (browser tab)' },
  { key: 'Alt+↑↓', label: 'Jump messages' },
  { key: 'Alt+C', label: 'Focus Chat' },
  { key: 'Alt+1', label: 'Sessions' },
  { key: 'Alt+2', label: 'Todos' },
  { key: 'Alt+3', label: 'Stash' },
  { key: 'Alt+4', label: 'Tasks' },
  { key: 'Alt+5', label: 'Bookmarks' },
  { key: 'Alt+6', label: 'Boards' },
  { key: 'Alt+7', label: 'Usage' },
  { key: 'Alt+8', label: 'MCP' },
  { key: 'Alt+9', label: 'Skills' },
  { key: 'Alt+?', label: 'Help' },
]

/**
 * Render workspace identity and keyboard shortcuts in the chat-history slot
 * when no session is active. The composer is rendered by ChatPanel directly
 * (hoisted out of the welcome/chat conditional) so it lives in identical DOM
 * position across both states.
 */
export default function WelcomeContent() {
  const { workspaceId, workspaces } = useWorkspace()
  const { workspaceColor } = useSessionsList()
  const isMobile = useIsMobile()

  const workspace = workspaces.find(w => w.id === workspaceId)
  const name = workspaceId || '-'
  const path = workspace?.path || ''

  const nameStyle = workspaceColor ? { color: workspaceColor } : undefined

  return (
    <div className="welcome-content" data-testid="welcome-page">
      <div className="welcome-identity">
        <h1 className="welcome-name" style={nameStyle}>
          {name}
        </h1>
        {path && <p className="welcome-path">{path}</p>}
      </div>

      {!isMobile && (
        <div className="welcome-shortcuts" data-testid="welcome-shortcuts">
          <h2 className="welcome-shortcuts-title">Keyboard Shortcuts</h2>
          <div className="welcome-shortcuts-grid">
            {SHORTCUTS.map(s => (
              <div key={s.key} className="welcome-shortcut-row">
                <kbd className="welcome-shortcut-key">{s.key}</kbd>
                <span className="welcome-shortcut-label">{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
