/** Vertical icon strip for panel toggles. */

import { useCallback, useEffect } from 'react'
import { useBottomPanels } from '../../context/BottomPanelsContext'
import IconButton from './components/IconButton'
import useBadgeCounts from './hooks/useBadgeCounts'

/**
 * Vertical icon strip - top section + optional bottom section.
 *
 * @param {object} props
 * @param {'left'|'right'} [props.position='right'] - Strip position.
 * @param {string[]} [props.panels=[]] - Panel IDs for main section.
 * @param {string[]} [props.bottomPanels=[]] - Panel IDs for bottom section.
 * @param {function} props.onTogglePanel - Toggle panel visibility.
 * @param {string[]} [props.activePanels=[]] - Currently active panel IDs.
 * @param {function} [props.onIconEnter] - Floating-panel mouseenter (panelId, buttonEl, position).
 * @param {function} [props.onIconLeave] - Floating-panel mouseleave.
 */
export default function IconStrip({
  position = 'right',
  panels = [],
  bottomPanels = [],
  onTogglePanel,
  activePanels = [],
  onIconEnter,
  onIconLeave,
}) {
  const { todoCount, stashCount, taskCount, mcpFailedCount, logsHasErrors } = useBadgeCounts()
  const { registerBottomPanel, unregisterBottomPanel } = useBottomPanels()

  // Register bottom-slot panel IDs with BottomPanelsContext.
  useEffect(() => {
    if (bottomPanels.length === 0) {
      return
    }
    for (const id of bottomPanels) {
      registerBottomPanel(id, position)
    }
    return () => {
      for (const id of bottomPanels) {
        unregisterBottomPanel(id)
      }
    }
  }, [bottomPanels, position, registerBottomPanel, unregisterBottomPanel])

  const getBadgeCount = id => {
    if (id === 'todos') {
      return todoCount
    }
    if (id === 'stash') {
      return stashCount
    }
    if (id === 'tasks') {
      return taskCount
    }
    if (id === 'mcp') {
      return mcpFailedCount
    }
    return 0
  }

  // MCP shows in danger (red) styling because the count represents servers
  // that failed to connect, not a benign work-in-progress count.
  const getBadgeVariant = id => (id === 'mcp' ? 'danger' : 'default')

  const getHasDot = id => {
    if (id === 'logs') {
      return logsHasErrors
    }
    return false
  }

  // Bind strip position to the icon enter handler
  const handleIconEnter = useCallback(
    (panelId, buttonEl) => {
      onIconEnter?.(panelId, buttonEl, position)
    },
    [onIconEnter, position],
  )

  const positionClass = position === 'left' ? 'icon-strip-left' : 'icon-strip-right'

  return (
    <div className={`icon-strip ${positionClass}`}>
      <div className="icon-strip-top">
        {panels.map(panelId => (
          <IconButton
            key={panelId}
            panelId={panelId}
            activePanels={activePanels}
            onTogglePanel={onTogglePanel}
            badgeCount={getBadgeCount(panelId)}
            badgeVariant={getBadgeVariant(panelId)}
            hasDot={getHasDot(panelId)}
            onIconEnter={onIconEnter ? handleIconEnter : undefined}
            onIconLeave={onIconLeave}
          />
        ))}
      </div>
      {bottomPanels.length > 0 && (
        <div className="icon-strip-bottom">
          {bottomPanels.map(panelId => (
            <IconButton
              key={panelId}
              panelId={panelId}
              activePanels={activePanels}
              onTogglePanel={onTogglePanel}
              badgeCount={getBadgeCount(panelId)}
              hasDot={getHasDot(panelId)}
              onIconEnter={onIconEnter ? handleIconEnter : undefined}
              onIconLeave={onIconLeave}
            />
          ))}
        </div>
      )}
    </div>
  )
}
