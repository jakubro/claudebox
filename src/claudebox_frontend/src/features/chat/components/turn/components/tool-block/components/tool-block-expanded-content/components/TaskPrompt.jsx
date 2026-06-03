/** Collapsible prompt section for Task tool. */

import CollapsibleSection from './CollapsibleSection'

/**
 * Render Task tool prompt in a collapsible section with Markdown formatting.
 * @param {Object} props
 * @param {string} props.prompt - The prompt text to display.
 * @param {boolean} [props.defaultExpanded=false] - Whether to start expanded.
 */
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
