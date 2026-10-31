/** The workspace's tools hidden from Focused by hand, in its global ui-state, synced across tabs. */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getUiState, patchGlobalUiState } from '../api/uiState'
import {
  FOCUSED_HIDDEN_TOOLS_PATH,
  FOCUSED_HIDDEN_TOOLS_CHANGE_SIGNAL_KEY as STORAGE_SIGNAL_KEY,
} from '../config/storage'

const NONE = new Set()

/**
 * Read the marked tool names on mount, on workspace switch and on another tab's signal - a later
 * read or a local write makes an earlier read stale - and mark or unmark tools optimistically.
 *
 * @param {string|null} workspaceId - Gates every read and write; `workspaceFetch` needs one.
 * @returns {{ hiddenTools: Set<string>, markTool: Function, unmarkTools: Function }}
 */
export default function useFocusedHiddenTools(workspaceId) {
  const [hiddenTools, setHiddenTools] = useState(NONE)
  const hiddenToolsRef = useRef(hiddenTools)
  const requestSeqRef = useRef(0)

  const fetchHiddenTools = useCallback(async () => {
    if (!workspaceId) {
      return
    }
    const seq = ++requestSeqRef.current
    try {
      const data = await getUiState()
      if (seq === requestSeqRef.current) {
        hiddenToolsRef.current = new Set(data.global?.[FOCUSED_HIDDEN_TOOLS_PATH] ?? [])
        setHiddenTools(hiddenToolsRef.current)
      }
    } catch (err) {
      console.warn('focusedHiddenTools: read failed', err)
    }
  }, [workspaceId])

  useEffect(() => {
    hiddenToolsRef.current = NONE
    setHiddenTools(NONE)
    fetchHiddenTools()
    return () => {
      requestSeqRef.current += 1
    }
  }, [fetchHiddenTools])

  useEffect(() => {
    const handleStorage = e => {
      if (e.key === STORAGE_SIGNAL_KEY) {
        fetchHiddenTools()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [fetchHiddenTools])

  const writeMarks = useCallback((next, ops) => {
    requestSeqRef.current += 1
    hiddenToolsRef.current = next
    setHiddenTools(next)
    // Signalled once the write lands: a tab reading on the signal must not beat the write.
    Promise.resolve(
      patchGlobalUiState(ops.map(op => ({ ...op, path: FOCUSED_HIDDEN_TOOLS_PATH }))),
    ).then(() => {
      try {
        localStorage.setItem(STORAGE_SIGNAL_KEY, Date.now().toString())
      } catch {
        // localStorage may be unavailable
      }
    })
  }, [])

  const markTool = useCallback(
    name => {
      if (workspaceId && name && !hiddenToolsRef.current.has(name)) {
        writeMarks(new Set([...hiddenToolsRef.current, name]), [{ op: 'add', value: name }])
      }
    },
    [workspaceId, writeMarks],
  )

  const unmarkTools = useCallback(
    names => {
      const marked = names.filter(name => hiddenToolsRef.current.has(name))
      if (workspaceId && marked.length) {
        writeMarks(
          new Set([...hiddenToolsRef.current].filter(name => !marked.includes(name))),
          marked.map(name => ({ op: 'remove', value: name })),
        )
      }
    },
    [workspaceId, writeMarks],
  )

  return { hiddenTools, markTool, unmarkTools }
}
