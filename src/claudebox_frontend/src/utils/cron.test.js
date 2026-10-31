/** Tests for the cron scheduler port. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeSchedule,
  formatMonthDay,
  nextCronMatch,
  nextFireTime,
  nextRecurringFire,
  parseCron,
} from './cron'

const utc = (y, mo, d, h = 0, mi = 0, s = 0, ms = 0) => Date.UTC(y, mo - 1, d, h, mi, s, ms)

describe('parseCron', () => {
  it('expands steps, ranges, stepped ranges and lists', () => {
    expect(parseCron('*/15 1-3 1-31/10 1,6 *')).toEqual({
      minute: [0, 15, 30, 45],
      hour: [1, 2, 3],
      dayOfMonth: [1, 11, 21, 31],
      month: [1, 6],
      dayOfWeek: [0, 1, 2, 3, 4, 5, 6],
    })
  })

  it('reads day-of-week 7 as Sunday', () => {
    expect(parseCron('0 9 * * 7').dayOfWeek).toEqual([0])
    expect(parseCron('0 9 * * 5-7').dayOfWeek).toEqual([0, 5, 6])
  })

  it.each([
    ['61 * * * *'],
    ['* * * *'],
    ['0 9 * * MON'],
    ['5-1 * * * *'],
    ['*/0 * * * *'],
    ['0 0 ? * *'],
    [''],
    [null],
  ])('rejects %j', expr => {
    expect(parseCron(expr)).toBeNull()
  })
})

describe('nextCronMatch', () => {
  it('returns the first whole minute strictly after the given time', () => {
    const fields = parseCron('30 10 * * *')

    expect(nextCronMatch(fields, utc(2026, 10, 13, 10, 30))).toBe(utc(2026, 10, 14, 10, 30))
    expect(nextCronMatch(fields, utc(2026, 10, 13, 10, 29, 59))).toBe(utc(2026, 10, 13, 10, 30))
  })

  it('rolls over months and years', () => {
    expect(nextCronMatch(parseCron('0 0 1 1 *'), utc(2026, 12, 31, 12))).toBe(utc(2027, 1, 1))
    expect(nextCronMatch(parseCron('0 0 31 * *'), utc(2026, 11, 1))).toBe(utc(2026, 12, 31))
  })

  it('fires on either restricted day field', () => {
    const fields = parseCron('0 0 13 * 5')

    // 2026-10-13 is a Tuesday; the next Friday is the 16th, the next 13th is November 13th.
    expect(nextCronMatch(fields, utc(2026, 10, 13, 1))).toBe(utc(2026, 10, 16))
    expect(nextCronMatch(fields, utc(2026, 11, 7, 1))).toBe(utc(2026, 11, 13))
  })

  it('gives up on a date that never comes', () => {
    expect(nextCronMatch(parseCron('0 0 31 2 *'), utc(2026, 1, 1))).toBeNull()
  })
})

describe('nextFireTime', () => {
  it('fires a one-time schedule on the hour early by its id-derived jitter', () => {
    const fire = nextFireTime(
      { cron: '0 5 13 10 *', id: '8a011f08', recurring: false },
      utc(2026, 10, 12, 21, 56, 50, 793),
    )

    // Observed: the CLI fired this schedule at 04:59:11.50.
    expect(Math.abs(fire - utc(2026, 10, 13, 4, 59, 11, 500))).toBeLessThan(100)
  })

  it('fires a one-time schedule off the half hour exactly on time', () => {
    const fire = nextFireTime(
      { cron: '1 13 12 10 *', id: '134ad238', recurring: false },
      utc(2026, 10, 12, 12, 3, 15),
    )

    expect(fire).toBe(utc(2026, 10, 12, 13, 1))
  })

  it('never fires a one-time schedule before it was created', () => {
    const created = utc(2026, 10, 13, 4, 59, 50)

    expect(nextFireTime({ cron: '0 5 13 10 *', id: 'ffffffff', recurring: false }, created)).toBe(
      created,
    )
  })

  it('delays a repeating fire by a share of its interval derived from the id', () => {
    const fire = nextFireTime(
      { cron: '17,47 * * * *', id: '8675f20c', recurring: true },
      utc(2026, 10, 12, 12, 4, 10),
    )

    // Observed: the CLI fired this schedule at 12:24:53.40 and 12:54:53.40; it polls once a second.
    const observed = utc(2026, 10, 12, 12, 24, 53, 400)
    expect(fire).toBeLessThanOrEqual(observed)
    expect(observed - fire).toBeLessThan(1000)
  })

  it('caps a repeating delay at half an hour', () => {
    const fire = nextFireTime(
      { cron: '0 9 * * *', id: 'ffffffff', recurring: true },
      utc(2026, 10, 12, 10),
    )

    expect(fire - utc(2026, 10, 13, 9)).toBe(30 * 60_000)
  })

  it('fires a five-minute schedule fifteen seconds short of five minutes after the last fire', () => {
    const fire = nextFireTime(
      { cron: '*/5 * * * *', id: '8675f20c', recurring: true },
      utc(2026, 10, 12, 12, 1, 30),
    )

    expect(fire).toBe(utc(2026, 10, 12, 12, 6, 15))
  })
})

describe('nextRecurringFire', () => {
  const SAME_DELAY_AS_OBSERVED =
    nextFireTime(
      { cron: '17,47 * * * *', id: '8675f20c', recurring: true },
      utc(2026, 10, 12, 12, 4, 10),
    ) - utc(2026, 10, 12, 12, 17)

  it('finds the upcoming grid fire long after creation', () => {
    const schedule = { cron: '17,47 * * * *', id: '8675f20c' }

    const fire = nextRecurringFire(schedule, utc(2026, 10, 12, 12, 4), utc(2026, 10, 14, 9, 30))

    expect(fire - utc(2026, 10, 14, 9, 47)).toBe(SAME_DELAY_AS_OBSERVED)
  })

  it('returns a fire still due after its match has passed', () => {
    const schedule = { cron: '17,47 * * * *', id: '8675f20c' }

    const fire = nextRecurringFire(schedule, utc(2026, 10, 12, 12, 4), utc(2026, 10, 14, 9, 20))

    expect(fire - utc(2026, 10, 14, 9, 17)).toBe(SAME_DELAY_AS_OBSERVED)
  })

  it('chains five-minute fires from the anchor', () => {
    const schedule = { cron: '*/5 * * * *', id: '00000000' }
    const anchor = utc(2026, 10, 12, 12, 1, 30)

    expect(nextRecurringFire(schedule, anchor, anchor + 10 * 60_000)).toBe(anchor + 3 * 285_000)
  })
})

describe('describeSchedule', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const now = utc(2026, 10, 13, 6)

  it.each([
    ['*/5 * * * *', 'every 5 min'],
    ['* * * * *', 'every minute'],
    ['17 * * * *', 'hourly at :17'],
    ['0 */4 * * *', 'every 4 hours'],
    ['30 9 * * *', 'daily at 09:30'],
    ['30 9 * * 1-5', 'weekdays at 09:30'],
    ['30 9 * * 1', 'Mondays at 09:30'],
    ['17,47 * * * *', '17,47 * * * * UTC'],
    ['0 9 1 * *', '0 9 1 * * UTC'],
  ])('words %s as %j in UTC', (cron, words) => {
    vi.stubEnv('TZ', 'UTC')

    expect(describeSchedule({ cron, recurring: true }, now)).toBe(words)
  })

  it('words a one-time schedule by its local date and time', () => {
    vi.stubEnv('TZ', 'Europe/Berlin')

    expect(describeSchedule({ cron: '0 5 13 10 *', recurring: false }, utc(2026, 10, 12, 22))).toBe(
      'once, Oct 13 07:00',
    )
  })

  it('moves the day with a local offset that crosses midnight', () => {
    vi.stubEnv('TZ', 'Asia/Kolkata')

    expect(describeSchedule({ cron: '0 20 * * *', recurring: true }, now)).toBe('daily at 01:30')
    expect(describeSchedule({ cron: '0 20 * * 1', recurring: true }, now)).toBe('Tuesdays at 01:30')
    expect(describeSchedule({ cron: '0 20 * * 1-5', recurring: true }, now)).toBe(
      '0 20 * * 1-5 UTC',
    )
    expect(describeSchedule({ cron: '45 * * * *', recurring: true }, now)).toBe('hourly at :15')
  })
})

describe('formatMonthDay', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('formats the local date', () => {
    vi.stubEnv('TZ', 'America/Los_Angeles')

    expect(formatMonthDay(utc(2026, 10, 20, 3))).toBe('Oct 19')
  })
})
