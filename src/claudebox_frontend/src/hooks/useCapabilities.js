/** Runtime capabilities + identity reader. */

import { useSessionData } from '../context/SessionDataContext'
import useSessionDefaults from './useSessionDefaults'

/**
 * Read the current runtime's capability matrix and display name.
 *
 * Source order: in-session `sessionData` first, workspace-level
 * `session-defaults` fallback for the pre-session welcome screen.
 * Returns `{capabilities: null}` during the brief race before either
 * source has resolved - consumers default to show-all in that window.
 *
 * @returns {{capabilities: object|null, runtimeName: string|null}}
 */
export default function useCapabilities() {
  const { capabilities, runtimeName } = useSessionData()
  const sessionDefaults = useSessionDefaults()
  return {
    capabilities: capabilities || sessionDefaults?.capabilities || null,
    runtimeName: runtimeName || sessionDefaults?.runtime_name || null,
  }
}
