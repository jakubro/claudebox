/** Panel displaying stashed text snippets with copy and pop actions. */

import { CornerRightUp } from 'lucide-react'
import CopyButton from '../../components/CopyButton.jsx'
import { useEvents } from '../../context/EventsContext'
import { useStash } from '../../context/StashContext'
import { getFirstLine } from '../../utils/formatters'

/** Render panel displaying stashed text snippets with copy and pop actions. */
export default function StashPanel() {
  const { stash, stashRemove } = useStash()
  const { isResuming, isReplaying } = useEvents()

  if (isResuming || isReplaying) {
    return (
      <div className="stash-panel stash-loading" data-testid="panel-stash">
        Resuming...
      </div>
    )
  }

  if (stash.length === 0) {
    return (
      <div className="stash-panel stash-empty" data-testid="stash-empty">
        <div>No stashed items</div>
        <div className="stash-hint">Ctrl+S to stash</div>
      </div>
    )
  }

  return (
    <div className="stash-panel" data-testid="panel-stash">
      {stash.map((item, i) => (
        <div key={item.timestamp} className="stash-item" data-testid="stash-item" title={item.text}>
          <span className="stash-text">{getFirstLine(item.text)}</span>
          <div className="stash-actions">
            <CopyButton text={item.text} size={12} />
            <button
              type="button"
              onClick={() => stashRemove(i)}
              title="Insert into input and remove">
              <CornerRightUp size={12} />
            </button>
          </div>
        </div>
      ))}
      <div className="stash-footer">Ctrl+S to stash | Ctrl+Shift+S to pop</div>
    </div>
  )
}
