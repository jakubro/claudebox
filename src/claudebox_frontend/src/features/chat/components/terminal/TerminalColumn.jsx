/** Session-wide shell transcript: every top-level Bash call, oldest first, windowed like the transcript. */

import { useRef } from 'react'
import useTerminalVirtualizer from '../../hooks/useTerminalVirtualizer'
import TerminalEntry from './components/TerminalEntry'

/** @param {Array<{id, turnId, command, description, result}>} props.entries */
export default function TerminalColumn({ entries, onEntryClick }) {
  const containerRef = useRef(null)
  const listRef = useRef(null)

  // The trailing entry renders outside the window - its height changes in place as it resolves.
  const windowedEntries = entries.slice(0, -1)
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null

  const { virtualizer, virtualItems, scrollMargin, windowed } = useTerminalVirtualizer({
    containerRef,
    listRef,
    entries: windowedEntries,
  })

  return (
    <div className="terminal-column" data-testid="terminal-column" ref={containerRef}>
      {entries.length === 0 ? (
        <div className="terminal-empty" data-testid="terminal-empty">
          No commands have run yet.
        </div>
      ) : !windowed ? (
        entries.map(entry => <TerminalEntry key={entry.id} entry={entry} onClick={onEntryClick} />)
      ) : (
        <>
          <div
            className="terminal-entries"
            ref={listRef}
            style={{ height: virtualizer.getTotalSize() }}>
            {virtualItems.map(item => (
              <div
                key={item.key}
                className="terminal-entry-row"
                data-index={item.index}
                ref={virtualizer.measureElement}
                style={{ transform: `translateY(${item.start - scrollMargin}px)` }}>
                <TerminalEntry entry={windowedEntries[item.index]} onClick={onEntryClick} />
              </div>
            ))}
          </div>
          {lastEntry && <TerminalEntry entry={lastEntry} onClick={onEntryClick} />}
        </>
      )}
    </div>
  )
}
