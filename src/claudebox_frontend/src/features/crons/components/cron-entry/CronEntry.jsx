/** One scheduled prompt: when it next fires, its schedule in words, its prompt and its session. */

import { describeSchedule, formatMonthDay } from '../../../../utils/cron'
import { formatDurationCompact, getFirstLine } from '../../../../utils/formatters'

/**
 * @param {object} props
 * @param {object} props.cron - A schedule from extractCrons.
 * @param {number} props.now - Current timestamp for the countdown.
 * @param {function} props.onClick - Jump to the call that created the schedule.
 * @param {function} [props.onAuxClick] - Middle-click handler.
 * @param {{name: string, isAutoNamed: boolean}|null} [props.session] - The session line, if shown.
 * @param {boolean} [props.opening] - Dims the row while its session opens in a new tab.
 */
export default function CronEntry({
  cron,
  now,
  onClick,
  onAuxClick,
  session = null,
  opening = false,
}) {
  const minutesLeft = Math.max(1, Math.ceil((cron.nextFireAt - now) / 60_000))
  const when = cron.due ? 'due' : `in ${formatDurationCompact(minutesLeft * 60)}`
  const schedule = describeSchedule(cron, cron.recurring ? now : cron.createdAt)
  const expiry = cron.recurring ? ` · expires ${formatMonthDay(cron.expiresAt)}` : ''

  return (
    <button
      type="button"
      className={`cron-entry${cron.due ? ' cron-due' : ''}${opening ? ' cron-entry-opening' : ''}`}
      onClick={onClick}
      onAuxClick={onAuxClick}
      data-testid="cron-entry">
      <span className="cron-when">{when}</span>
      <span className="cron-schedule">
        {schedule}
        {expiry}
      </span>
      <span className="cron-prompt" title={cron.prompt}>
        {getFirstLine(cron.prompt, 120)}
      </span>
      {session && (
        <span className={`cron-session-name${session.isAutoNamed ? ' auto-named' : ''}`}>
          {session.name}
        </span>
      )}
    </button>
  )
}
