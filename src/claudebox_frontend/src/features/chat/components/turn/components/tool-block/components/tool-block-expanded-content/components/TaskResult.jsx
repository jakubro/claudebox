/** Collapsible result section for Task tool. */

import { useSessionWorkspace } from '../../../../../../../../../context/SessionDataContext'
import CollapsibleSection from './CollapsibleSection'

export default function TaskResult({ result, defaultExpanded = false }) {
  const workspaceDir = useSessionWorkspace()

  return (
    <CollapsibleSection
      label="Result"
      content={result}
      defaultExpanded={defaultExpanded}
      baseDir={workspaceDir}
      showCopy
      className="task-result"
    />
  )
}
