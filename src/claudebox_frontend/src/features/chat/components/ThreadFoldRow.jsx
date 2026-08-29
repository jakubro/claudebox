/** Openable stand-in for a promoted thread's turns inherited from its source. */

import { ChevronDown, ChevronRight } from 'lucide-react'
import { useSessionsList } from '../../../context/SessionsContext'
import { resolveSessionName } from '../utils/settingLabels'

/**
 * @param {object} props
 * @param {number} props.turnCount - Inherited turns this row stands in for.
 * @param {string} props.sourceSessionId - The conversation these turns were forked from.
 * @param {boolean} props.expanded
 * @param {Function} props.onToggle
 */
export default function ThreadFoldRow({ turnCount, sourceSessionId, expanded, onToggle }) {
  const { sessions } = useSessionsList()
  const sourceName = resolveSessionName(sessions, sourceSessionId)

  return (
    <button
      type="button"
      className="thread-fold-row"
      onClick={onToggle}
      data-testid="thread-fold-row"
      aria-expanded={expanded}>
      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      <span className="thread-fold-row-label">
        {turnCount} earlier {turnCount === 1 ? 'turn' : 'turns'} from {sourceName}
      </span>
    </button>
  )
}
