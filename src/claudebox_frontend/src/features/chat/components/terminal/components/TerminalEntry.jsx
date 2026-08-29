/** One shell-call entry: description comment, command line, and output - flat, no header. */

import { CornerUpLeft } from 'lucide-react'
import { forwardRef } from 'react'
import CopyButton from '../../../../../components/CopyButton.jsx'
import { ToolName } from '../../../../../config/schema'
import PersistedOutputContent from '../../turn/components/tool-block/components/tool-block-expanded-content/components/PersistedOutputContent'
import DefaultCodeBlock from '../../turn/components/tool-block/components/tool-block-expanded-content/components/tool-content-renderer/components/DefaultCodeBlock'
import { extractToolResult } from '../../turn/components/tool-block/utils/toolResultFormatters'
import { resultContentOf } from '../utils/terminalResult'

/**
 * @param {object} props.entry - From deriveTerminalEntries; onClick fires only if entry.turnId.
 * @param {number} [props.index] - Position among every entry, not just windowed ones; carried as
 *   `data-index` so one selector reaches it in either branch.
 * @param {object} ref - Forwarded to the root element; the trailing entry uses it to observe its
 *   own in-place growth (see TerminalColumn).
 */
const TerminalEntry = forwardRef(function TerminalEntry({ entry, index, onClick }, ref) {
  const { id, turnId, command, description, result } = entry
  const isPending = !result

  const extracted = isPending
    ? null
    : extractToolResult(ToolName.BASH, { command, description }, resultContentOf(result))
  const isFailed = !isPending && (!!result?.is_error || !!extracted?.isError)
  const output = extracted ? (extracted.details ?? extracted.summary) : ''

  return (
    <div className="terminal-entry" data-testid="terminal-entry" data-index={index} ref={ref}>
      {turnId != null && (
        <button
          type="button"
          className="copy-btn terminal-jump-btn"
          title="Jump to this turn"
          onClick={e => {
            e.stopPropagation()
            onClick?.(entry)
          }}>
          <CornerUpLeft size={12} />
        </button>
      )}
      <CopyButton text={command} className="terminal-copy-btn" title="Copy command" size={12} />
      {description && <div className="terminal-entry-comment"># {description}</div>}
      <div className={`terminal-entry-command-line${isFailed ? ' terminal-entry-failed' : ''}`}>
        <span className="terminal-entry-prompt">$</span>
        <span className="terminal-entry-command">{command}</span>
      </div>
      {isPending ? (
        <div className="terminal-entry-pending" data-testid="terminal-entry-pending">
          Running...
        </div>
      ) : extracted.persistedOutput ? (
        <PersistedOutputContent
          preview={output}
          toolUseId={id}
          fileSize={extracted.persistedOutput.fileSize}
          previewSize={extracted.persistedOutput.previewSize}
        />
      ) : (
        <div className="terminal-entry-output">
          <DefaultCodeBlock content={output} />
        </div>
      )}
    </div>
  )
})

export default TerminalEntry
