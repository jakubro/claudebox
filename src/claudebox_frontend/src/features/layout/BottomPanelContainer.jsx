/** Bottom-panel strip above the footer: 1 slot full-width, 2 slots split 50/50, shared height. */

import { useEffect, useMemo } from 'react'
import { LOGS_STRIP_MAX_HEIGHT_RATIO, LOGS_STRIP_MIN_HEIGHT } from '../../config/dimensions'
import { components } from '../../config/layout'
import { useAppActions } from '../../context/AppActionsContext'
import { useBottomPanels } from '../../context/BottomPanelsContext'
import { usePointerDragHandle } from '../../hooks/usePointerDragHandle'

export default function BottomPanelContainer() {
  const { openSet, height, panelSideMap, setHeight } = useBottomPanels()
  const { isMaximized } = useAppActions()

  // Orders panels left-then-right to match the icon strips that toggle them.
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

  // Drives `.app-container` height via :root CSS var so the row reclaims space on collapse.
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

  const { handlePointerDown, handlePointerMove, handlePointerUp } = usePointerDragHandle({
    axis: 'y',
    onDragStart: () => ({ startHeight: height }),
    onDragMove: (drag, dy) => setHeight(drag.startHeight - dy),
  })

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
