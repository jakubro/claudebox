/** Horizontally scrollable session filter strip with edge chevrons when it overflows. */

import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import PanelListItem from '../../../components/PanelListItem'
import {
  SESSION_FILTER_ICONS,
  SESSION_FILTER_LABELS,
  SESSION_FILTER_ORDER,
} from '../utils/sessionTree'

/** Scroll step for a chevron click - sized to move at least one tab, not a fixed pixel count. */
const SCROLL_STEP_PX = 90

/**
 * @param {object} props
 * @param {string} props.activeFilter - Currently chosen SESSION_FILTERS value.
 * @param {(filter: string) => void} props.onSelectFilter - Filter click handler.
 * @param {(filter: string) => number} props.getCount - Badge count for one filter.
 */
export default function SessionsFilterStrip({ activeFilter, onSelectFilter, getCount }) {
  const stripRef = useRef(null)
  const [showLeftChevron, setShowLeftChevron] = useState(false)
  const [showRightChevron, setShowRightChevron] = useState(false)

  // Same room-in-each-direction check nestedScrollable.js already uses for its own x-axis test.
  const updateChevrons = useCallback(() => {
    const el = stripRef.current
    if (!el) {
      return
    }
    setShowLeftChevron(el.scrollLeft > 0)
    setShowRightChevron(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  // Native and non-passive: React registers onWheel passive at the root, where preventDefault is
  // a no-op - this is what lets the strip consume the gesture instead of the list below scrolling.
  useEffect(() => {
    const el = stripRef.current
    if (!el) {
      return undefined
    }
    const handleWheel = e => {
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  // Panel resize changes how much of the strip fits.
  useEffect(() => {
    const el = stripRef.current
    if (!el) {
      return undefined
    }
    updateChevrons()
    const observer = new ResizeObserver(updateChevrons)
    observer.observe(el)
    return () => observer.disconnect()
  }, [updateChevrons])

  // A count going from one digit to two changes the strip's own content width.
  const countsSignature = SESSION_FILTER_ORDER.map(getCount).join(',')
  // biome-ignore lint/correctness/useExhaustiveDependencies: countsSignature is the trigger
  useEffect(() => {
    updateChevrons()
  }, [updateChevrons, countsSignature])

  // Covers both a click and the auto-switch to All, which no click precedes.
  useEffect(() => {
    stripRef.current
      ?.querySelector(`[data-testid="sessions-filter-${activeFilter}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' })
  }, [activeFilter])

  const scrollByStep = direction => {
    stripRef.current?.scrollBy({ left: direction * SCROLL_STEP_PX, behavior: 'smooth' })
  }

  return (
    <div className="sessions-filter-strip-wrapper">
      {showLeftChevron && (
        <button
          type="button"
          className="sessions-filter-chevron sessions-filter-chevron-left"
          onClick={() => scrollByStep(-1)}
          title="Scroll filters left">
          <ChevronLeft size={12} />
        </button>
      )}
      <div
        className="sessions-tabs"
        ref={stripRef}
        onScroll={updateChevrons}
        data-testid="sessions-tabs">
        {SESSION_FILTER_ORDER.map(filter => (
          <PanelListItem
            key={filter}
            label={SESSION_FILTER_LABELS[filter]}
            icon={SESSION_FILTER_ICONS[filter]}
            active={activeFilter === filter}
            onClick={() => onSelectFilter(filter)}
            count={getCount(filter)}
            showZero
            testId={`sessions-filter-${filter}`}
          />
        ))}
      </div>
      {showRightChevron && (
        <button
          type="button"
          className="sessions-filter-chevron sessions-filter-chevron-right"
          onClick={() => scrollByStep(1)}
          title="Scroll filters right">
          <ChevronRight size={12} />
        </button>
      )}
    </div>
  )
}
