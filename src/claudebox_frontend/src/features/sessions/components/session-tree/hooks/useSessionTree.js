/** Access session tree state from context. */

import { useContext } from 'react'
import { SessionTreeContext } from '../SessionTreeContext'

/** Access session tree state from context. */
export function useSessionTree() {
  const context = useContext(SessionTreeContext)
  if (!context) {
    throw new Error('useSessionTree must be used within SessionTreeProvider')
  }
  return context
}
