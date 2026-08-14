/** Collapsible result section for Task tool. */

import CollapsibleSection from './CollapsibleSection'

export default function TaskResult({ result, defaultExpanded = false }) {
  return (
    <CollapsibleSection
      label="Result"
      content={result}
      defaultExpanded={defaultExpanded}
      showCopy
      className="task-result"
    />
  )
}
