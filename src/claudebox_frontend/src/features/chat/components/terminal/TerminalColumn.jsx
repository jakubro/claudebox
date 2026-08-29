/** Session-wide shell transcript: every top-level Bash call, oldest first, windowed like the transcript. */

import { useEffect, useRef } from 'react'
import useTerminalVirtualizer from '../../hooks/useTerminalVirtualizer'
import { useScrollElementRef } from '../../hooks/useVirtualListGeometry'
import TerminalEntry from './components/TerminalEntry'

/**
 * @param {Array<{id, turnId, command, description, result}>} props.entries
 * @param {object} [props.containerRef] - Scroll container ref from `useColumnScroll`, owned by
 *   `ChatPanel`; falls back to a local ref when no caller supplies one (bare-mounted in tests).
 * @param {object} [props.virtualizerRef] - Filled with the virtualizer for step navigation.
 * @param {object} [props.trailingEntryRef] - Ref to the trailing entry's element, for step
 *   navigation's trailing target and the in-place-growth effect below.
 * @param {function} [props.onScroll] - Forwarded to the scroll container's native scroll event.
 * @param {function} [props.scrollToBottom] - Re-pins the trailing entry's growth while engaged.
 * @param {object} [props.metricsCacheRef] - Shared with the overview's bar builder, so an entry's
 *   content is extracted once.
 * @param {boolean} [props.minimapPinned] - Reserves right-edge padding under a pinned overview.
 */
export default function TerminalColumn({
  entries,
  onEntryClick,
  containerRef,
  virtualizerRef,
  trailingEntryRef,
  onScroll,
  scrollToBottom,
  metricsCacheRef,
  minimapPinned = false,
}) {
  const ownContainerRef = useRef(null)
  const resolvedContainerRef = containerRef || ownContainerRef
  const [containerEl, attachContainerRef] = useScrollElementRef(resolvedContainerRef)
  const ownTrailingEntryRef = useRef(null)
  const resolvedTrailingEntryRef = trailingEntryRef || ownTrailingEntryRef
  const listRef = useRef(null)

  // The trailing entry renders outside the window - its height changes in place as it resolves.
  const windowedEntries = entries.slice(0, -1)
  const lastEntry = entries.length > 0 ? entries[entries.length - 1] : null
  const lastIndex = entries.length - 1

  const { virtualizer, virtualItems, scrollMargin, windowed } = useTerminalVirtualizer({
    containerEl,
    listRef,
    entries: windowedEntries,
    metricsCacheRef,
  })
  if (virtualizerRef) {
    virtualizerRef.current = virtualizer
  }

  // The trailing entry grows in place as output arrives, which follow-on-append never sees since
  // the entry count is unchanged - re-pin on every resize while autoscroll is engaged.
  // biome-ignore lint/correctness/useExhaustiveDependencies: lastEntry?.id retriggers on a node swap
  useEffect(() => {
    const el = resolvedTrailingEntryRef.current
    if (!(el && scrollToBottom)) {
      return undefined
    }
    const observer = new ResizeObserver(() => scrollToBottom())
    observer.observe(el)
    return () => observer.disconnect()
  }, [lastEntry?.id, scrollToBottom])

  return (
    <div
      className={`terminal-column${minimapPinned ? ' minimap-pinned' : ''}`}
      data-testid="terminal-column"
      ref={attachContainerRef}
      onScroll={onScroll}>
      {entries.length === 0 ? (
        <div className="terminal-empty" data-testid="terminal-empty">
          No commands have run yet.
        </div>
      ) : !windowed ? (
        entries.map((entry, i) => (
          <TerminalEntry
            key={entry.id}
            entry={entry}
            index={i}
            ref={i === lastIndex ? resolvedTrailingEntryRef : undefined}
            onClick={onEntryClick}
          />
        ))
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
                <TerminalEntry
                  entry={windowedEntries[item.index]}
                  index={item.index}
                  onClick={onEntryClick}
                />
              </div>
            ))}
          </div>
          {lastEntry && (
            <TerminalEntry
              ref={resolvedTrailingEntryRef}
              entry={lastEntry}
              index={lastIndex}
              onClick={onEntryClick}
            />
          )}
        </>
      )}
    </div>
  )
}
