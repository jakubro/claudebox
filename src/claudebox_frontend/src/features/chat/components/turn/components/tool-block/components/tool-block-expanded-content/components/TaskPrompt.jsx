/** Collapsible prompt section for Task tool. */

import { useSessionWorkspace } from '../../../../../../../../../context/SessionDataContext'
import CollapsibleSection from './CollapsibleSection'

export default function TaskPrompt({ prompt, defaultExpanded = false }) {
  const workspaceDir = useSessionWorkspace()

  return (
    <CollapsibleSection
      label="Prompt"
      content={prompt}
      defaultExpanded={defaultExpanded}
      baseDir={workspaceDir}
      showCopy
      className="task-prompt"
    />
  )
}
