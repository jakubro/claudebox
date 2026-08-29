/** Overview for a right-slot column: one bar per entry - height, width, and colour price it. */

import { useMinimapOverlay } from './useMinimapOverlay'

/**
 * Shared by the terminal's and the work column's overviews - `variant` names every class and
 * testid, so each column keeps the DOM contract its own SPEC claims and e2e specs read.
 *
 * @param {'terminal'|'work'} props.variant - Which column this instance belongs to.
 * @param {Array<{id, height, width, status}>} props.bars - Prebuilt bars for this column.
 * @param {object} props.containerRef - Ref to the column's own scroll container.
 * @param {function} props.getAutoScrollEnabled - Getter for the column's autoscroll state.
 * @param {function} props.getLogicalScrollHeight - Thumb-size denominator, summed from `bars`.
 * @param {function} [props.onScrollLanding] - Fired after a click/drag with whether it landed at
 *   the bottom, so the caller can transition the column's scroll owner.
 * @param {boolean} [props.persistent] - Pinned open, independent of the other overviews.
 */
export default function ColumnMinimap({
  variant,
  bars,
  containerRef,
  getAutoScrollEnabled,
  getLogicalScrollHeight,
  onScrollLanding = null,
  persistent = false,
}) {
  const {
    mapRef,
    visible,
    viewport,
    handleClick,
    handlePointerDown,
    handlePointerEnter,
    handlePointerLeave,
  } = useMinimapOverlay({
    containerRef,
    getAutoScrollEnabled,
    getLogicalScrollHeight,
    onScrollLanding,
    persistent,
    reattachTrigger: bars.length,
  })

  if (bars.length === 0) {
    return null
  }

  return (
    <div
      className={`${variant}-minimap-overlay ${visible ? 'visible' : ''}`}
      ref={mapRef}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      data-testid={`${variant}-minimap`}>
      <div className={`${variant}-minimap-bars`}>
        {bars.map(bar => (
          <div
            key={bar.id}
            className={`${variant}-minimap-bar ${variant}-minimap-bar-${bar.status}`}
            style={{ flex: bar.height, width: bar.width }}
            data-testid={`${variant}-minimap-bar`}
          />
        ))}
      </div>
      <div
        className={`${variant}-minimap-thumb`}
        style={{ top: viewport.top, height: viewport.height }}
        data-testid={`${variant}-minimap-viewport`}
      />
    </div>
  )
}
