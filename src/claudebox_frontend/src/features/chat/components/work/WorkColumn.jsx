/** Session-wide work panel: every routed-away tool call, oldest first, grouped by turn. */

// audit-ignore-file: excessive-props

import { useCallback, useMemo, useRef } from 'react'
import { useScrollElementRef } from '../../hooks/useVirtualListGeometry'
import useWorkPanelVirtualizer from '../../hooks/useWorkPanelVirtualizer'
import { hasAnyWorkPanelContent } from '../../utils/predictWorkEntryHeight'
import WorkTurnEntry from './components/WorkTurnEntry'

/**
 * `turns` is the full session list - a turn with nothing routed away costs one predicted height
 * and renders nothing, so no filter pass runs before windowing.
 *
 * @param {Array} props.turns - Every turn in the session, oldest first, active turn included.
 * @param {string} props.mode - TurnRoutingMode; ALL_TOOLS whenever this column is mounted.
 * @param {string|null} [props.activeTurnId] - The live turn's id, for per-entry `isActiveTurn`.
 * @param {boolean} [props.isActive] - Whether the active turn is currently responding.
 * @param {number} [props.now] - Live-ticking clock; only the active entry reads it.
 * @param {Function} [props.onEntryJump] - (turnId) => void - scrolls the transcript to that turn.
 * @param {object} [props.containerRef] - Scroll container ref, owned above this component.
 * @param {function} [props.scrollToBottom] - Re-pins the trailing row's growth while engaged.
 * @param {object} [props.metricsCacheRef] - Shared with the overview's bar builder, so a settled
 *   turn is priced once.
 * @param {boolean} [props.minimapPinned] - Reserves right-edge padding under a pinned overview.
 */
export default function WorkColumn({
  turns,
  mode,
  activeTurnId = null,
  isActive = false,
  now,
  todoDiffs,
  taskNotifications,
  hasPendingMessages,
  onFormSubmit,
  registerPendingForm,
  duplicateAskUserIds,
  onEntryJump,
  containerRef,
  virtualizerRef,
  onScroll,
  scrollToBottom,
  metricsCacheRef,
  minimapPinned = false,
}) {
  const ownContainerRef = useRef(null)
  const resolvedContainerRef = containerRef || ownContainerRef
  const [containerEl, attachContainerRef] = useScrollElementRef(resolvedContainerRef)
  const listRef = useRef(null)
  const trailingObserverRef = useRef(null)
  const trailingElRef = useRef(null)

  const { virtualizer, virtualItems, scrollMargin, windowed } = useWorkPanelVirtualizer({
    containerEl,
    containerRef: resolvedContainerRef,
    listRef,
    turns,
    mode,
    metricsCacheRef,
  })
  if (virtualizerRef) {
    virtualizerRef.current = virtualizer
  }

  // The trailing row grows in place, so re-pin on every resize while autoscroll is engaged.
  // Attached by ref callback and idempotent: a flip swaps the node under one turn id, and
  // re-observing the same element would re-fire the initial callback and snap to the bottom.
  const attachTrailingRow = useCallback(
    el => {
      if (el === trailingElRef.current) {
        return
      }
      trailingElRef.current = el
      if (trailingObserverRef.current) {
        trailingObserverRef.current.disconnect()
        trailingObserverRef.current = null
      }
      if (el && scrollToBottom) {
        const observer = new ResizeObserver(() => scrollToBottom())
        observer.observe(el)
        trailingObserverRef.current = observer
      }
    },
    [scrollToBottom],
  )

  // Every turn's own entry renders nothing when it routed nothing away, so an all-prose session
  // would otherwise show a blank, zero-height column instead of the empty state.
  const isEmpty = useMemo(() => !hasAnyWorkPanelContent(turns, mode), [turns, mode])

  // Identical across every entry - built once so WorkTurnEntry's memo isn't defeated by a fresh
  // object every render.
  const sessionScope = useMemo(
    () => ({
      hasPendingMessages,
      todoDiffs,
      taskNotifications,
      onFormSubmit,
      registerPendingForm,
      duplicateAskUserIds,
    }),
    [
      hasPendingMessages,
      todoDiffs,
      taskNotifications,
      onFormSubmit,
      registerPendingForm,
      duplicateAskUserIds,
    ],
  )

  const renderEntry = i => {
    const turn = turns[i]
    if (!turn) {
      return null
    }
    const nextMsg = turns[i + 1]?.userMessage
    const nextMessageInfo = {
      hasNextUserMessage: !!nextMsg,
      nextUserMessageIsFormResponse:
        nextMsg?.includes('<response:AskUserQuestion>') ||
        nextMsg?.includes('<response:ExitPlanMode>'),
      nextUserMessage: nextMsg || null,
    }
    return (
      <WorkTurnEntry
        turn={turn}
        mode={mode}
        nextMessageInfo={nextMessageInfo}
        sessionScope={sessionScope}
        now={now}
        isActiveTurn={isActive && turn.turn_id != null && turn.turn_id === activeTurnId}
        onJump={onEntryJump}
      />
    )
  }

  return (
    <div
      className={`work-column${minimapPinned ? ' minimap-pinned' : ''}`}
      data-testid="work-column"
      ref={attachContainerRef}
      onScroll={onScroll}>
      {isEmpty ? (
        <div className="work-empty" data-testid="work-empty">
          No work has happened yet.
        </div>
      ) : !windowed ? (
        // .work-row carries no styling - it gives step navigation one selector across both
        // branches. .work-entry-row is the windowed branch's transform-positioned layout class.
        turns.map((turn, i) => (
          <div
            key={turn.turn_id ?? i}
            className="work-row"
            data-index={i}
            ref={i === turns.length - 1 ? attachTrailingRow : undefined}>
            {renderEntry(i)}
          </div>
        ))
      ) : (
        <div className="work-entries" ref={listRef} style={{ height: virtualizer.getTotalSize() }}>
          {virtualItems.map((item, i) => (
            <div
              key={item.key}
              className="work-entry-row work-row"
              data-index={item.index}
              ref={el => {
                virtualizer.measureElement(el)
                if (i === virtualItems.length - 1) {
                  attachTrailingRow(el)
                }
              }}
              style={{ transform: `translateY(${item.start - scrollMargin}px)` }}>
              {renderEntry(item.index)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
