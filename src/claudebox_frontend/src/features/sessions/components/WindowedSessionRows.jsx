/** Windowed session list - mounts the rows in view plus overscan, so cost stops tracking session count. */

import { useCallback, useRef } from 'react'
import {
  SESSION_LIST_OVERSCAN,
  SESSION_ROW_ESTIMATE_PX,
  SESSION_ROW_ORIGIN_LINE_PX,
} from '../../../config/dimensions'
import {
  useVirtualizerGeometry,
  useWindowedVirtualizer,
} from '../../../hooks/useVirtualListGeometry'

/**
 * Window `rows` against `scrollEl`, the list's own scroll container; with no measurable viewport,
 * every row renders.
 *
 * @param {object} props
 * @param {HTMLElement|null} props.scrollEl - The scrolling element the rows sit in.
 * @param {object[]} props.rows - Rows in display order.
 * @param {(row: object) => string} props.getKey - Stable key per row, kept across refetches.
 * @param {(row: object) => React.ReactNode} props.renderRow - Renders one row.
 * @param {boolean} [props.withOrigin=false] - Rows carry the extra origin line.
 */
export default function WindowedSessionRows({
  scrollEl,
  rows,
  getKey,
  renderRow,
  withOrigin = false,
}) {
  const listRef = useRef(null)
  const { initialRect, scrollMargin } = useVirtualizerGeometry(scrollEl, listRef)
  const rowEstimate = SESSION_ROW_ESTIMATE_PX + (withOrigin ? SESSION_ROW_ORIGIN_LINE_PX : 0)
  const estimateSize = useCallback(() => rowEstimate, [rowEstimate])
  const getItemKey = useCallback(index => getKey(rows[index]), [getKey, rows])

  const virtualizer = useWindowedVirtualizer({
    count: rows.length,
    scrollEl,
    estimateSize,
    getItemKey,
    initialRect,
    scrollMargin,
    overscan: SESSION_LIST_OVERSCAN,
  })
  const virtualItems = virtualizer.getVirtualItems()

  if (rows.length > 0 && virtualItems.length === 0) {
    return (
      <div ref={listRef}>
        {rows.map(row => (
          <div key={getKey(row)} className="sessions-window-row-static">
            {renderRow(row)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div ref={listRef} className="sessions-window" style={{ height: virtualizer.getTotalSize() }}>
      {virtualItems.map(item => (
        <div
          key={item.key}
          className="sessions-window-row"
          data-index={item.index}
          ref={virtualizer.measureElement}
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}>
          {renderRow(rows[item.index])}
        </div>
      ))}
    </div>
  )
}
