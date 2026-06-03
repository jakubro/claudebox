/** Board info rendered in the main-area header LEFT slot when a board view is active. */

import { LayoutGrid } from 'lucide-react'
import { useCallback } from 'react'
import useCopyFlash from '../../../hooks/useCopyFlash'
import useBoardData from '../../boards/hooks/useBoardData'

/**
 * Render the board info — board icon plus board name, click-to-copy the board's filesystem path.
 *
 * Renders as siblings of the surrounding `.session-header-strip-left` flex container —
 * no wrapper div, no pill chrome.
 *
 * @param {object} props
 * @param {string} props.boardId - Board ID to display (drives useBoardData lookup).
 */
export default function BoardHeaderInfo({ boardId }) {
  const { board } = useBoardData(boardId)
  const [copied, copy] = useCopyFlash()

  const handleClick = useCallback(() => {
    const target = board?.path ?? boardId
    if (target) {
      copy(target)
    }
  }, [board, boardId, copy])

  const label = board?.name ?? boardId

  return (
    <>
      <LayoutGrid size={11} className="session-header-strip-board-icon" />
      <button
        type="button"
        className="session-header-strip-name"
        onClick={handleClick}
        title={board?.path ? `Board path — ${board.path}` : label}
        data-testid="board-header"
        data-board-id={boardId}>
        <span style={{ visibility: copied ? 'hidden' : 'visible' }}>{label}</span>
        {copied && <span className="session-header-strip-name-copied">Copied!</span>}
      </button>
    </>
  )
}
