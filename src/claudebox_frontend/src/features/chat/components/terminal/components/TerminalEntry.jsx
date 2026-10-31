/** One shell-call entry: description comment, command line, and output - flat, no header. */

import { Bookmark, CornerUpLeft } from 'lucide-react'
import { forwardRef } from 'react'
import CopyButton from '../../../../../components/CopyButton.jsx'
import { ToolName } from '../../../../../config/schema'
import { useOptionalBookmarks } from '../../../../../context/BookmarksContext'
import { toolBookmarkKey } from '../../../../../utils/bookmarkIds'
import { reminderEntries } from '../../../../../utils/eventProcessing'
import InjectedContext from '../../turn/components/InjectedContext'
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
  const { id, turnId, command, commandLayout, description, result, injected } = entry
  const isPending = !result
  const bookmarks = useOptionalBookmarks()
  const bookmarkKey = bookmarks && turnId != null ? toolBookmarkKey(id) : null
  const isBookmarked = !!bookmarkKey && bookmarks.isBookmarked(turnId, bookmarkKey)

  const extracted = isPending
    ? null
    : extractToolResult(ToolName.BASH, { command, description }, resultContentOf(result))
  const isFailed = !isPending && (!!result?.is_error || !!extracted?.isError)
  const output = extracted ? (extracted.details ?? extracted.summary) : ''
  const addedEntries = [...reminderEntries(extracted?.systemReminders ?? []), ...(injected ?? [])]

  return (
    <div
      className={`terminal-entry${isBookmarked ? ' bookmarked' : ''}`}
      data-testid="terminal-entry"
      data-index={index}
      data-tool-use-id={id}
      ref={ref}>
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
      {bookmarkKey && (
        <button
          type="button"
          className={`copy-btn terminal-bookmark-btn${isBookmarked ? ' active' : ''}`}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this tool call'}
          onClick={e => {
            e.stopPropagation()
            bookmarks.toggleBookmark(turnId, bookmarkKey, command)
          }}>
          <Bookmark size={12} fill={isBookmarked ? 'currentColor' : 'none'} />
        </button>
      )}
      <CopyButton text={command} className="terminal-copy-btn" title="Copy command" size={12} />
      {description && <div className="terminal-entry-comment"># {description}</div>}
      <div className={`terminal-entry-command-line${isFailed ? ' terminal-entry-failed' : ''}`}>
        <span className="terminal-entry-prompt">$</span>
        <span className="terminal-entry-command">{commandLayout ?? command}</span>
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
      {addedEntries.length > 0 && (
        <div className="injected-context-corner">
          <InjectedContext entries={addedEntries} />
        </div>
      )}
    </div>
  )
})

export default TerminalEntry
