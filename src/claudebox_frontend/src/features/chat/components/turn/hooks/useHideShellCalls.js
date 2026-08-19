/** Read the terminal-split shell-call routing flag from HideShellCallsContext. */

import { useContext } from 'react'
import { HideShellCallsContext } from '../HideShellCallsContext'

/** Defaults to `false` when no provider is mounted. */
export function useHideShellCalls() {
  return useContext(HideShellCallsContext)
}
