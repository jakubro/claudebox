/** Registry of views the chat content area's right slot can mount - one occupant, one record. */

import { CHAT_TERMINAL_MIN_WIDTH, CHAT_WORK_MIN_WIDTH } from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import TerminalColumn from '../components/terminal'
import WorkColumn from '../components/work'

/**
 * View ids, stable across sessions - used as the slot's own resolution key, never persisted raw.
 * `OFF` is the persisted preference's third value (see `useTerminalSplit`), not a registered view.
 */
export const RightSlotView = Object.freeze({
  OFF: 'off',
  TERMINAL: 'terminal',
  WORK: 'work',
})

/**
 * One object literal per view: id, control text, routing mode, component, and minimum width. No
 * registration side effects and no dynamic import - the slot resolves an id and mounts it.
 */
export const RIGHT_SLOT_VIEWS = Object.freeze({
  [RightSlotView.TERMINAL]: {
    id: RightSlotView.TERMINAL,
    label: 'Terminal',
    title: "Show agent's terminal",
    routingMode: TurnRoutingMode.BASH_ONLY,
    component: TerminalColumn,
    minWidth: CHAT_TERMINAL_MIN_WIDTH,
  },
  [RightSlotView.WORK]: {
    id: RightSlotView.WORK,
    label: 'Work',
    title: "Show the agent's work",
    routingMode: TurnRoutingMode.ALL_TOOLS,
    component: WorkColumn,
    minWidth: CHAT_WORK_MIN_WIDTH,
  },
})

/** The routing mode a resolved view implies - OFF when no view is currently showing. */
export function resolveRightSlotRoutingMode(activeView) {
  return activeView?.routingMode ?? TurnRoutingMode.OFF
}

/** Read the persisted view: `rightSlotView` when present, else the older boolean key. */
export function resolveStoredRightSlotView(session) {
  if (session?.rightSlotView) {
    return session.rightSlotView
  }
  return session?.terminalSplitEnabled ? RightSlotView.TERMINAL : RightSlotView.OFF
}
