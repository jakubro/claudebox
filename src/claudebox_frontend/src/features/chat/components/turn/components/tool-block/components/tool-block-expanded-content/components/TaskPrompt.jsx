/** Collapsible prompt section for Task tool. */

import CollapsibleSection from './CollapsibleSection'

export default function TaskPrompt({ prompt, defaultExpanded = false }) {
  return (
    <CollapsibleSection
      label="Prompt"
      content={prompt}
      defaultExpanded={defaultExpanded}
      showCopy
      className="task-prompt"
    />
  )
}
