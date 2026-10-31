/** A subagent's narration between calls in the Activity section - markdown, no chrome. */

import Markdown from '../../../../../../../../../components/Markdown'
import { useSessionWorkspace } from '../../../../../../../../../context/SessionDataContext'

export default function NestedTextEntry({ event }) {
  const workspaceDir = useSessionWorkspace()
  return (
    <div className="nested-text-entry turn-text">
      <Markdown baseDir={workspaceDir}>{event.content}</Markdown>
    </div>
  )
}
