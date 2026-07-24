/** Read central turn-collapse state from TurnCollapseContext. */

import { useContext } from 'react'
import { TurnCollapseContext } from '../TurnCollapseContext'

/** Access central turn-collapse state, or null when rendered without a provider. */
export function useTurnCollapse() {
  return useContext(TurnCollapseContext)
}
