/** Which turn blocks route to the chat content area's right slot instead of rendering inline. */

import { createContext } from 'react'
import { TurnRoutingMode } from '../../../../utils/eventProcessing'

export const TurnRoutingContext = createContext(TurnRoutingMode.OFF)
