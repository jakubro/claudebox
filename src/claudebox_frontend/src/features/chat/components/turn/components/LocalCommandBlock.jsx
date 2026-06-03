/** Collapsible block for displaying local command stdout/stderr output. */

import { ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import { useState } from 'react'

/**
 * Display collapsible command output with toggle header and styled content.
 * @param {object} props
 * @param {'stdout'|'stderr'} props.type - Output stream type.
 * @param {string} props.content - Command output content.
 */
export default function LocalCommandBlock({ type, content }) {
  const [expanded, setExpanded] = useState(true)
  const isStderr = type === 'stderr'

  return (
    <div
      className={`local-command-block ${isStderr ? 'local-command-stderr' : 'local-command-stdout'}`}>
      <button type="button" className="local-command-header" onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Terminal size={14} />
        <span className="local-command-label">{isStderr ? 'stderr' : 'stdout'}</span>
      </button>
      {expanded && <pre className="local-command-content">{content}</pre>}
    </div>
  )
}
