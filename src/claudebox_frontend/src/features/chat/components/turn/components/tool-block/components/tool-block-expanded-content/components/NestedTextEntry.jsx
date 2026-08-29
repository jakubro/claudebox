/** A subagent's narration between calls in the Activity section - markdown, no chrome. */

import Markdown from '../../../../../../../../../components/Markdown'

export default function NestedTextEntry({ event }) {
  return (
    <div className="nested-text-entry turn-text">
      <Markdown>{event.content}</Markdown>
    </div>
  )
}
