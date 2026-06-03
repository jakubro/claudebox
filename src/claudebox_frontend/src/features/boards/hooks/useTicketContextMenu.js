/** Right-click context menu state shared by ticket cards and links. */

import { useCallback, useState } from 'react'

/**
 * Manage open/close state and event-stop semantics for a ticket's context menu.
 * @param {string} ticketPath - Stable ticket identifier passed back to onArchive.
 * @param {Function} [onArchive] - Archive callback fired when the menu's Archive button is clicked.
 */
export default function useTicketContextMenu(ticketPath, onArchive) {
  const [contextMenu, setContextMenu] = useState(null)

  const handleContextMenu = useCallback(e => {
    e.preventDefault()
    // Stop bubbling to the parent BoardColumn cell, which has its own context menu.
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const closeMenu = useCallback(() => setContextMenu(null), [])

  const handleArchiveClick = useCallback(() => {
    setContextMenu(null)
    onArchive?.(ticketPath)
  }, [ticketPath, onArchive])

  return { contextMenu, handleContextMenu, closeMenu, handleArchiveClick }
}
