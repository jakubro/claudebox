/** Collapsible result section for Task tool. */

import CollapsibleSection from './CollapsibleSection'

/**
 * Render Task tool result in a collapsible section with Markdown formatting.
 * @param {Object} props
 * @param {string} props.result - The result text to display.
 * @param {boolean} [props.defaultExpanded=false] - Whether to start expanded.
 */
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
