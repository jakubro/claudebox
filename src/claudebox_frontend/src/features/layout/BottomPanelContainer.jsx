/** Bottom-panel container — renders 1-or-2 horizontal slots above the footer. */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { LOGS_STRIP_MAX_HEIGHT_RATIO, LOGS_STRIP_MIN_HEIGHT } from '../../config/dimensions'
import { components } from '../../config/layout'
import { useAppActions } from '../../context/AppActionsContext'
import { useBottomPanels } from '../../context/BottomPanelsContext'
import { isPrimaryPointer } from '../../utils/pointer'

/** Bottom-panel strip — 1 slot full-width, 2 slots split 50/50; single shared height. */
export default function BottomPanelContainer() {
  const { openSet, height, panelSideMap, setHeight } = useBottomPanels()
  const { isMaximized } = useAppActions()

  // Order open panels by side (left first, right second) so the rendered
  // slots match the visual order of the icon strips that toggle them.
  const visible = useMemo(() => {
    const ids = [...openSet].filter(id => panelSideMap.has(id))
    return ids.sort((a, b) => {
      const sideA = panelSideMap.get(a)
      const sideB = panelSideMap.get(b)
      if (sideA === sideB) {
        return 0
      }
      return sideA === 'left' ? -1 : 1
    })
  }, [openSet, panelSideMap])

  const stripVisible = visible.length > 0 && !isMaximized

  // Drive `.app-container` height via :root CSS var so the main row reclaims
  // the space when the strip collapses.
  useEffect(() => {
    if (!stripVisible) {
      document.documentElement.style.removeProperty('--logs-strip-h')
      return
    }
    document.documentElement.style.setProperty('--logs-strip-h', `${height}px`)
    return () => {
      document.documentElement.style.removeProperty('--logs-strip-h')
    }
  }, [stripVisible, height])

  const dragRef = useRef(null)

  const handlePointerDown = useCallback(
    e => {
      if (!isPrimaryPointer(e)) {
        return
      }
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      dragRef.current = { startY: e.clientY, startHeight: height }
    },
    [height],
  )

  const handlePointerMove = useCallback(
    e => {
      if (!dragRef.current) {
        return
      }
      const dy = e.clientY - dragRef.current.startY
      setHeight(dragRef.current.startHeight - dy)
    },
    [setHeight],
  )

  const handlePointerUp = useCallback(e => {
    if (!dragRef.current) {
      return
    }
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }, [])

  if (!stripVisible) {
    return null
  }

  const isSplit = visible.length === 2

  return (
    <div className="bottom-panel-container" data-testid="bottom-panel-container">
      {/* biome-ignore lint/a11y/useSemanticElements: separator carries drag handlers + aria-value{now,min,max}; <hr> drops them */}
      <div
        className="bottom-panel-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize bottom panels"
        aria-valuenow={height}
        aria-valuemin={LOGS_STRIP_MIN_HEIGHT}
        aria-valuemax={Math.floor(window.innerHeight * LOGS_STRIP_MAX_HEIGHT_RATIO)}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <div className="bottom-panel-slots">
        {visible.map(panelId => {
          const PanelComponent = components[panelId]
          if (!PanelComponent) {
            return null
          }
          const side = panelSideMap.get(panelId) || 'left'
          return (
            <div
              key={panelId}
              className={`bottom-panel-slot bottom-panel-slot-${side} bottom-panel-slot-${isSplit ? 'split' : 'full'}`}
              data-testid={`bottom-panel-slot-${panelId}`}>
              <PanelComponent />
            </div>
          )
        })}
      </div>
    </div>
  )
}
