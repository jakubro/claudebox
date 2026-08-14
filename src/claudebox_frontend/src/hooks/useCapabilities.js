/** Runtime capabilities + identity reader. */

import { useSessionData } from '../context/SessionDataContext'
import useSessionDefaults from './useSessionDefaults'

/**
 * Source order: in-session `sessionData` first, then workspace `session-defaults` (pre-session
 * welcome screen). Null during the brief race before either resolves; consumers default to show-all.
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
