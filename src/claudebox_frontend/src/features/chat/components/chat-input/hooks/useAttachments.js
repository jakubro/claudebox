/** Manage file attachments via paste, drag-drop, and programmatic addition. */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { readFileAsBase64, validateFile } from '../../../../../utils/attachmentHelpers'

const EMPTY_ATTACHMENTS = [] // audit-ignore: misplaced-constant

/**
 * @param {Object} params
 * @param {Function} params.setError - Error setter from InteractionContext
 * @param {Object} params.textareaRef - Ref to textarea element (for X11 paste guard)
 * @param {string|null} params.ownerSessionId - Attachments belong to the session they were added in
 *   and are kept, in memory, per session.
 * @returns {{ attachments, setAttachments, removeAttachment, handlePaste, handleDragOver, handleDragLeave, handleDrop }}
 */
export default function useAttachments({ setError, textareaRef, ownerSessionId }) {
  const ownerKey = ownerSessionId ?? ''
  const [byOwner, setByOwner] = useState({})
  const attachments = useMemo(() => byOwner[ownerKey] ?? EMPTY_ATTACHMENTS, [byOwner, ownerKey])
  const ownerKeyRef = useRef(ownerKey)
  ownerKeyRef.current = ownerKey

  // An updater applies to the session it was issued for, even once the reader has moved on.
  const updateFor = useCallback((key, next) => {
    setByOwner(prev => {
      const current = prev[key] ?? EMPTY_ATTACHMENTS
      return { ...prev, [key]: typeof next === 'function' ? next(current) : next }
    })
  }, [])

  const setAttachments = useCallback(next => updateFor(ownerKeyRef.current, next), [updateFor])
  const [dragOver, setDragOver] = useState(false)
  const middleClickOutsideRef = useRef(false)

  // Blocks paste from a middle-click outside the textarea (X11 behavior); needs mousedown capture
  // since IconTab stops propagation and X11 fires paste on button-down. Flag clears via mouseup+rAF,
  // not setTimeout, to survive a held click (>100ms).
  useEffect(() => {
    const handleMouseDown = e => {
      if (e.button === 1 && textareaRef.current && e.target !== textareaRef.current) {
        middleClickOutsideRef.current = true
      }
    }
    const handleMouseUp = e => {
      if (e.button === 1 && middleClickOutsideRef.current) {
        requestAnimationFrame(() => {
          middleClickOutsideRef.current = false
        })
      }
    }

    document.addEventListener('mousedown', handleMouseDown, { capture: true })
    document.addEventListener('mouseup', handleMouseUp, { capture: true })
    return () => {
      document.removeEventListener('mousedown', handleMouseDown, { capture: true })
      document.removeEventListener('mouseup', handleMouseUp, { capture: true })
    }
  }, [textareaRef])

  const addFiles = useCallback(
    async files => {
      const key = ownerKeyRef.current
      for (const file of files) {
        const error = validateFile(file)
        if (error) {
          setError(error)
          continue
        }
        try {
          const data = await readFileAsBase64(file)
          updateFor(key, prev => [
            ...prev,
            {
              id: crypto.randomUUID(),
              name: file.name,
              type: file.type || 'application/octet-stream',
              data,
              size: file.size,
            },
          ])
        } catch (_err) {
          setError(`Failed to read ${file.name}`)
        }
      }
    },
    [setError, updateFor],
  )

  const removeAttachment = useCallback(
    id => {
      setAttachments(prev => prev.filter(a => a.id !== id))
    },
    [setAttachments],
  )

  // Handle paste - block X11 middle-click paste, detect files/images
  const handlePaste = useCallback(
    e => {
      if (middleClickOutsideRef.current) {
        e.preventDefault()
        return
      }
      const files = e.clipboardData?.files
      if (files && files.length > 0) {
        e.preventDefault()
        void addFiles(Array.from(files))
      }
    },
    [addFiles],
  )

  const handleDragOver = useCallback(e => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(e => {
    // Only clear if leaving the wrapper (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback(
    e => {
      e.preventDefault()
      setDragOver(false)
      const files = e.dataTransfer?.files
      if (files && files.length > 0) {
        void addFiles(Array.from(files))
      }
    },
    [addFiles],
  )

  return {
    attachments,
    setAttachments,
    dragOver,
    removeAttachment,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
