/** Read the right-slot routing mode from TurnRoutingContext. */

import { useContext } from 'react'
import { TurnRoutingContext } from '../TurnRoutingContext'

/** Defaults to `TurnRoutingMode.OFF` when no provider is mounted. */
export function useTurnRoutingMode() {
  return useContext(TurnRoutingContext)
}
