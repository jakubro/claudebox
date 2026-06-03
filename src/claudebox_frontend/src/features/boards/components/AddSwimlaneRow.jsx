/** Inline row for creating new swimlanes at the bottom of the board. */

import { useCallback, useRef, useState } from 'react'
import { createSwimlane } from '../../../api/boards'

/**
 * Render the "Add swimlane" row at the bottom of the board.
 * @param {object} props
 * @param {string} props.boardId - Board ID for API calls.
 * @param {Function} props.refresh - Refresh board data.
 */
export default function AddSwimlaneRow({ boardId, refresh }) {
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const inputRef = useRef(null)

  const handleClick = useCallback(() => {
    setAdding(true)
    setName('')
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleSubmit = useCallback(async () => {
    setAdding(false)
    const trimmed = name.trim()
    if (!trimmed) {
      return
    }
    try {
      await createSwimlane(boardId, trimmed)
      refresh()
    } catch (err) {
      console.error('Failed to create swimlane:', err)
    }
  }, [boardId, name, refresh])

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Enter') {
        handleSubmit()
      }
      if (e.key === 'Escape') {
        setAdding(false)
      }
    },
    [handleSubmit],
  )

  if (adding) {
    return (
      <div className="swimlane-add-row">
        <input
          ref={inputRef}
          className="swimlane-name-input"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          placeholder="Swimlane name..."
        />
      </div>
    )
  }

  return (
    <div className="swimlane-add-row">
      <button type="button" className="swimlane-add-btn" onClick={handleClick}>
        + Add swimlane
      </button>
    </div>
  )
}
