/** Five-field cron parsing and fire-time prediction, mirroring the agent CLI's own scheduler (UTC). */

import {
  CRON_CACHE_LEAD_MS,
  CRON_CACHE_WINDOW_MS,
  CRON_ONE_SHOT_MAX_JITTER_MS,
  CRON_RECURRING_JITTER_CAP_MS,
} from '../config/timing'

const FIELD_RANGES = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12 },
  { min: 0, max: 6 },
]
const ONE_SHOT_JITTER_MINUTE_MOD = 30
const RECURRING_JITTER_FRACTION = 0.5
const EVERY_N_MINUTES = /^\*\/\d+ \* \* \* \*$/
const SEARCH_LIMIT_MINUTES = 527_040
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
]

/** Parse a five-field cron expression into sorted value lists per field; null when invalid. */
export function parseCron(expr) {
  if (typeof expr !== 'string') {
    return null
  }
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    return null
  }
  const fields = parts.map((part, i) => parseField(part, FIELD_RANGES[i]))
  if (fields.some(f => f === null)) {
    return null
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

/** First whole UTC minute strictly after `afterMs` matching `fields`, searched up to a year ahead. */
export function nextCronMatch(fields, afterMs) {
  const minutes = new Set(fields.minute)
  const hours = new Set(fields.hour)
  const days = new Set(fields.dayOfMonth)
  const months = new Set(fields.month)
  const weekdays = new Set(fields.dayOfWeek)
  const anyDay = fields.dayOfMonth.length === 31
  const anyWeekday = fields.dayOfWeek.length === 7
  const d = new Date(afterMs)
  d.setUTCSeconds(0, 0)
  d.setUTCMinutes(d.getUTCMinutes() + 1)

  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++) {
    if (!months.has(d.getUTCMonth() + 1)) {
      d.setUTCMonth(d.getUTCMonth() + 1, 1)
      d.setUTCHours(0, 0, 0, 0)
      continue
    }
    const dayMatches =
      anyDay && anyWeekday
        ? true
        : anyDay
          ? weekdays.has(d.getUTCDay())
          : anyWeekday
            ? days.has(d.getUTCDate())
            : days.has(d.getUTCDate()) || weekdays.has(d.getUTCDay())
    if (!dayMatches) {
      d.setUTCDate(d.getUTCDate() + 1)
      d.setUTCHours(0, 0, 0, 0)
      continue
    }
    if (!hours.has(d.getUTCHours())) {
      d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0)
      continue
    }
    if (!minutes.has(d.getUTCMinutes())) {
      d.setUTCMinutes(d.getUTCMinutes() + 1)
      continue
    }
    return d.getTime()
  }
  return null
}

/** The CLI's jittered fire after `fromMs` - a repeating schedule's last fire, a one-time one's creation. */
export function nextFireTime({ cron, id, recurring }, fromMs) {
  const fields = parseCron(cron)
  if (!fields) {
    return null
  }
  const match = nextCronMatch(fields, fromMs)
  if (match === null) {
    return null
  }
  if (!recurring) {
    if (new Date(match).getUTCMinutes() % ONE_SHOT_JITTER_MINUTE_MOD !== 0) {
      return match
    }
    return Math.max(match - jitterFraction(id) * CRON_ONE_SHOT_MAX_JITTER_MS, fromMs)
  }
  const following = nextCronMatch(fields, match)
  if (following === null) {
    return match
  }
  const interval = following - match
  if (cacheLeadApplies(cron, interval)) {
    return fromMs + interval - CRON_CACHE_LEAD_MS
  }
  return (
    match +
    Math.min(
      jitterFraction(id) * RECURRING_JITTER_FRACTION * interval,
      CRON_RECURRING_JITTER_CAP_MS,
    )
  )
}

/** A repeating schedule's first fire at or after `nowMs`, counting from `anchorMs` (creation or resume). */
export function nextRecurringFire(schedule, anchorMs, nowMs) {
  const fields = parseCron(schedule.cron)
  if (!fields) {
    return null
  }
  const first = nextCronMatch(fields, anchorMs)
  const second = first === null ? null : nextCronMatch(fields, first)
  if (first === null) {
    return null
  }
  if (second !== null && cacheLeadApplies(schedule.cron, second - first)) {
    const step = second - first - CRON_CACHE_LEAD_MS
    return anchorMs + Math.max(1, Math.ceil((nowMs - anchorMs) / step)) * step
  }
  // A grid fire trails its match by at most the jitter cap, so earlier matches cannot reach `nowMs`.
  let from = Math.max(anchorMs, nowMs - CRON_RECURRING_JITTER_CAP_MS - 60_000)
  for (let i = 0; i < SEARCH_LIMIT_MINUTES; i++) {
    const fire = nextFireTime({ ...schedule, recurring: true }, from)
    if (fire === null || fire >= nowMs) {
      return fire
    }
    from = fire
  }
  return null
}

/** The schedule in words, in local time - "once, Oct 13 07:00", "every 5 min", "daily at 09:30". */
export function describeSchedule({ cron, recurring }, nowMs) {
  const fields = parseCron(cron)
  const match = fields ? nextCronMatch(fields, nowMs) : null
  if (match === null) {
    return `${cron} UTC`
  }
  const at = new Date(match)
  const clock = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  if (!recurring) {
    return `once, ${formatMonthDay(match)} ${clock}`
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = cron.trim().split(/\s+/)
  const singleMinute = /^\d+$/.test(minute)
  const singleHour = /^\d+$/.test(hour)
  if (dayOfMonth !== '*' || month !== '*') {
    return `${cron} UTC`
  }
  if (EVERY_N_MINUTES.test(cron.trim()) || cron.trim() === '* * * * *') {
    const n = minute === '*' ? 1 : Number(minute.slice(2))
    return n === 1 ? 'every minute' : `every ${n} min`
  }
  if (dayOfWeek === '*' && singleMinute && hour === '*') {
    return `hourly at :${pad(at.getMinutes())}`
  }
  if (dayOfWeek === '*' && singleMinute && /^\*\/\d+$/.test(hour)) {
    return `every ${Number(hour.slice(2))} hours`
  }
  if (singleMinute && singleHour) {
    if (dayOfWeek === '*') {
      return `daily at ${clock}`
    }
    if (dayOfWeek === '1-5' && at.getDay() === at.getUTCDay()) {
      return `weekdays at ${clock}`
    }
    if (/^\d$/.test(dayOfWeek)) {
      return `${WEEKDAYS[at.getDay()]} at ${clock}`
    }
  }
  return `${cron} UTC`
}

/** A local short date - "Oct 20". */
export function formatMonthDay(ms) {
  const d = new Date(ms)
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`
}

function jitterFraction(id) {
  const frac = Number.parseInt(String(id).slice(0, 8), 16) / 2 ** 32
  return Number.isFinite(frac) ? frac : 0
}

function cacheLeadApplies(cron, interval) {
  return (
    EVERY_N_MINUTES.test(cron.trim()) &&
    CRON_CACHE_LEAD_MS < interval &&
    interval >= CRON_CACHE_WINDOW_MS &&
    interval - CRON_CACHE_LEAD_MS < CRON_CACHE_WINDOW_MS
  )
}

function parseField(part, { min, max }) {
  const values = new Set()
  const isWeekday = min === 0 && max === 6
  for (const item of part.split(',')) {
    const step = item.match(/^\*(?:\/(\d+))?$/)
    if (step) {
      const n = step[1] ? Number.parseInt(step[1], 10) : 1
      if (n < 1) {
        return null
      }
      for (let v = min; v <= max; v += n) {
        values.add(v)
      }
      continue
    }
    const range = item.match(/^(\d+)-(\d+)(?:\/(\d+))?$/)
    if (range) {
      const [lo, hi] = [Number.parseInt(range[1], 10), Number.parseInt(range[2], 10)]
      const n = range[3] ? Number.parseInt(range[3], 10) : 1
      if (lo > hi || n < 1 || lo < min || hi > (isWeekday ? 7 : max)) {
        return null
      }
      for (let v = lo; v <= hi; v += n) {
        values.add(isWeekday && v === 7 ? 0 : v)
      }
      continue
    }
    if (/^\d+$/.test(item)) {
      let v = Number.parseInt(item, 10)
      if (isWeekday && v === 7) {
        v = 0
      }
      if (v < min || v > max) {
        return null
      }
      values.add(v)
      continue
    }
    return null
  }
  return values.size > 0 ? [...values].sort((a, b) => a - b) : null
}

function pad(n) {
  return String(n).padStart(2, '0')
}
