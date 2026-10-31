/** A side thread's exchanges, each drawn by the conversation's own turn component. */

import { useMemo } from 'react'
import { computeDuplicateAskUserIds } from '../../../../utils/eventProcessing'
import { dividerRows } from '../../utils/settingLabels'
import SettingChangeDivider from '../SettingChangeDivider'
import Turn from '../turn'
import { turnRecordProps } from '../turn/utils/turnContent'
import { deriveThreadTurns } from './threadEvents'

const NOOP = () => {}
// Stable default - a fresh [] per render would re-derive the exchanges every time.
const NO_PENDING = [] // audit-ignore: misplaced-constant

/**
 * @param {object} props
 * @param {Array} props.events - The thread's own events.
 * @param {Array} [props.pending] - Questions asked but not yet echoed back, as `{content, at}`.
 * @param {boolean} props.running - Whether the latest exchange is still being answered.
 * @param {string} props.sessionId - The thread's own session, for reads its blocks address.
 * @param {string} [props.quote] - The quote shown above, left out of the first question it heads.
 * @param {function} [props.onFormSubmit] - (answer) to the thread's questions; omit if read-only.
 */
export default function ThreadExchanges({
  events,
  pending = NO_PENDING,
  running,
  sessionId,
  quote = null,
  onFormSubmit,
}) {
  const { turns, turnResults, todoDiffs, taskNotifications } = useMemo(
    () => deriveThreadTurns(events, pending, quote),
    [events, pending, quote],
  )
  const duplicateAskUserIds = useMemo(() => computeDuplicateAskUserIds(turns), [turns])

  return turns.map((turn, i) => {
    const last = i === turns.length - 1
    const nextMsg = last ? null : turns[i + 1].userMessage

    return (
      <div className="inline-thread-turn" key={turn.turn_id ?? `exchange-${i}`}>
        <Turn
          {...turnRecordProps(turn)}
          sessionId={sessionId}
          todoDiffs={todoDiffs}
          taskNotifications={taskNotifications}
          resultStatus={turn.turn_id ? turnResults[turn.turn_id] : null}
          interrupted={turn.interrupted}
          isActive={running && last}
          showProgress={running && last}
          hasNextUserMessage={!!nextMsg}
          nextUserMessageIsFormResponse={
            nextMsg?.includes('<response:AskUserQuestion>') ||
            nextMsg?.includes('<response:ExitPlanMode>')
          }
          nextUserMessage={nextMsg}
          duplicateAskUserIds={duplicateAskUserIds}
          onFormSubmit={onFormSubmit}
          registerPendingForm={NOOP}
        />
        {dividerRows(turn.settingChanges || []).map((row, ri) => (
          <SettingChangeDivider key={`sc-${ri}`} events={row} />
        ))}
      </div>
    )
  })
}
