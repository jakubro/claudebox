/** Registry of views the chat content area's right slot can mount - one occupant, one record. */

import { CHAT_TERMINAL_MIN_WIDTH, CHAT_WORK_MIN_WIDTH } from '../../../config/dimensions'
import { TurnRoutingMode } from '../../../utils/eventProcessing'
import TerminalColumn from '../components/terminal'
import WorkColumn from '../components/work'

/**
 * The chat's views, persisted per session as `rightSlotView`. Only Terminal and Work mount a right
 * column, so only they are registered below; Focused and Everything keep the transcript whole.
 */
export const RightSlotView = Object.freeze({
  FOCUSED: 'focused',
  EVERYTHING: 'everything',
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

/**
 * The routing mode the picked `view` implies: FOCUSED on a phone or for the Focused view, the
 * mounted column's own mode when one shows, OFF otherwise - Everything, or a column too wide to fit.
 */
export function resolveRightSlotRoutingMode(view, activeView, isMobile = false) {
  if (isMobile || view === RightSlotView.FOCUSED) {
    return TurnRoutingMode.FOCUSED
  }
  return activeView?.routingMode ?? TurnRoutingMode.OFF
}

/**
 * Read the persisted view: a session that never picked one is Focused; the older `off` and
 * `terminalSplitEnabled: false` were the whole transcript, now Everything.
 */
export function resolveStoredRightSlotView(session) {
  const stored = session?.rightSlotView
  if (stored === 'off') {
    return RightSlotView.EVERYTHING
  }
  if (stored) {
    return stored
  }
  if (session?.terminalSplitEnabled === undefined) {
    return RightSlotView.FOCUSED
  }
  return session.terminalSplitEnabled ? RightSlotView.TERMINAL : RightSlotView.EVERYTHING
}
