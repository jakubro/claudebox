/** A turn end of a session this one spawned, shown under that session's name inside the reply. */

import CopyButton from '../../../../../components/CopyButton.jsx'
import Markdown from '../../../../../components/Markdown'
import { useSessionWorkspace } from '../../../../../context/SessionDataContext'
import InjectedContext from './InjectedContext'

/**
 * @param {string} props.content - The sibling turn's text, system reminders already stripped
 * @param {string} props.fromSessionId - The session that sent it
 * @param {string|null} [props.fromName] - Its name, when it has one
 * @param {Array} [props.injected] - Text no one wrote that the agent received with or after it
 */
export default function SiblingMessageBlock({ content, fromSessionId, fromName, injected = null }) {
  const workspaceDir = useSessionWorkspace()
  const label = fromName || fromSessionId.slice(0, 8)

  return (
    <div
      className="sibling-message"
      data-testid="sibling-message"
      data-from-session-id={fromSessionId}>
      <div className="sibling-message-from">from {label}</div>
      <Markdown baseDir={workspaceDir}>{content}</Markdown>
      <CopyButton
        text={content}
        className="sibling-message-copy-btn"
        title="Copy message"
        size={12}
      />
      {injected?.length > 0 && (
        <div className="injected-context-corner">
          <InjectedContext entries={injected} />
        </div>
      )}
    </div>
  )
}
