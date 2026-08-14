/** Manage file attachments via paste, drag-drop, and programmatic addition. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { readFileAsBase64, validateFile } from '../../../../../utils/attachmentHelpers'

/**
 * @param {Object} params
 * @param {Function} params.setError - Error setter from InteractionContext
 * @param {Object} params.textareaRef - Ref to textarea element (for X11 paste guard)
 * @returns {{ attachments, setAttachments, removeAttachment, handlePaste, handleDragOver, handleDragLeave, handleDrop }}
 */
export default function useAttachments({ setError, textareaRef }) {
  const [attachments, setAttachments] = useState([])
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
      for (const file of files) {
        const error = validateFile(file)
        if (error) {
          setError(error)
          continue
        }
        try {
          const data = await readFileAsBase64(file)
          setAttachments(prev => [
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
    [setError],
  )

  const removeAttachment = useCallback(id => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

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
