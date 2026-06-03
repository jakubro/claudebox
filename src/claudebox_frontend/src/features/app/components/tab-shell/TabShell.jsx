/** Reusable tab shell with right-click context menu and inline rename. */

import { Pin, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Render a tab `<div>` and centralise the cross-tab affordances:
 *
 *  - Right-click context menu rendered via portal, with outside-click and
 *    Escape closing. Items are produced by `getContextMenuItems`, which
 *    receives an api object so menu actions can call `startRename()` or
 *    `closeContextMenu()` without consumers wiring the state themselves.
 *  - Inline rename input: state, focus, Enter/Escape, blur-cancels.
 *  - Optional close button rendered when `isCloseable` is true.
 *  - Optional pin indicator rendered when `isPinned` is true.
 *
 * Variant-specific leading content (icons, container dots, spinners) goes in
 * `children` so consumers stay declarative.
 *
 * @param {object} props
 * @param {string} props.className - className for the outer tab div.
 * @param {boolean} [props.isCloseable] - Render the X close button.
 * @param {boolean} [props.isPinned] - Render the pin indicator.
 * @param {string|null|undefined} props.title - Tab label.
 * @param {{title?: string, close?: string}} [props.classes] - Extra classes for inner elements.
 * @param {(api: {startRename: () => void, closeContextMenu: () => void}) => Array<{label: string, onClick: () => void} | {separator: true}>} [props.getContextMenuItems]
 *   Function returning context menu items. Omit to disable the menu entirely.
 * @param {(name: string) => void | Promise<void>} [props.onRenameSave]
 *   Called with the trimmed new name when the rename input is submitted.
 *   Omit to disable inline rename.
 * @param {{onClick?: Function, onMouseDown?: Function, onDoubleClick?: Function, onClose?: Function}} [props.events]
 *   Outer-div + close-button event handlers.
 * @param {object} [props.dataAttrs] - Extra `data-*` attributes for the outer div.
 * @param {React.ReactNode} props.children - Variant-specific leading content.
 */
export default function TabShell({
  className,
  isCloseable = false,
  isPinned = false,
  title,
  classes,
  getContextMenuItems,
  onRenameSave,
  events,
  dataAttrs,
  children,
}) {
  const [contextMenu, setContextMenu] = useState(null)
  const contextMenuRef = useRef(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState('')

  const closeContextMenu = useCallback(() => setContextMenu(null), [])

  const startRename = useCallback(() => {
    if (!onRenameSave) {
      return
    }
    setContextMenu(null)
    setEditName(title || '')
    setIsEditing(true)
  }, [onRenameSave, title])

  const cancelRename = useCallback(() => {
    setIsEditing(false)
    setEditName('')
  }, [])

  const saveRename = useCallback(async () => {
    setIsEditing(false)
    if (!onRenameSave) {
      return
    }
    await onRenameSave(editName.trim())
  }, [editName, onRenameSave])

  // Close context menu on outside click or Escape.
  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const handleMouseDown = e => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target)) {
        setContextMenu(null)
      }
    }
    const handleKeyDown = e => {
      if (e.key === 'Escape') {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [contextMenu])

  const handleContextMenu = useCallback(
    e => {
      if (!getContextMenuItems) {
        return
      }
      e.preventDefault()
      setContextMenu({ x: e.clientX, y: e.clientY })
    },
    [getContextMenuItems],
  )

  const items =
    contextMenu && getContextMenuItems
      ? getContextMenuItems({ startRename, closeContextMenu })
      : null

  return (
    <>
      <div
        className={className}
        onClick={events?.onClick}
        onMouseDown={events?.onMouseDown}
        onDoubleClick={events?.onDoubleClick}
        onContextMenu={handleContextMenu}
        {...(dataAttrs || {})}>
        {isPinned && <Pin size={10} style={{ color: 'var(--text-muted)' }} />}
        {children}
        {isEditing ? (
          <input
            type="text"
            className="session-tab-edit-input"
            value={editName}
            onChange={e => setEditName(e.target.value)}
            autoFocus
            onBlur={cancelRename}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void saveRename()
              }
              if (e.key === 'Escape') {
                cancelRename()
              }
            }}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className={classes?.title}>{title}</span>
        )}
        {isCloseable && (
          <button
            type="button"
            className={`icon-tab-close${classes?.close ? ` ${classes.close}` : ''}`}
            onClick={events?.onClose}>
            <X size={12} />
          </button>
        )}
      </div>
      {items &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="session-tab-context-menu"
            style={{ top: contextMenu.y, left: contextMenu.x }}>
            {items.map((item, i) =>
              item.separator ? (
                <div key={`sep-${i}`} className="session-tab-context-separator" />
              ) : (
                <button
                  key={`item-${i}`}
                  type="button"
                  className="dropdown-option"
                  onClick={item.onClick}>
                  {item.label}
                </button>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  )
}
