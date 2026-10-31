/** Tests for CronsPanel. */

import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CronsPanel from './CronsPanel'

const NOW = Date.UTC(2026, 9, 12, 12, 0, 0)
const mockEvents = []
const mockEventsData = {
  isResuming: false,
  isReplaying: false,
  isResponding: false,
  respondingSince: null,
}
const mockFocusChatTab = vi.fn()
const mockJumpToTaskRef = { current: null }
const mockNavigate = vi.fn()
const mockToast = vi.fn()
const mockOpenInNewTab = vi.fn()
let mockSessionId = 'own'
let mockSessions = []
let mockSchedules = { sources: [], loaded: true, failed: false }

vi.mock('../../context/EventsContext', () => ({
  useEvents: () => ({ events: mockEvents, ...mockEventsData }),
}))
vi.mock('../../context/AppActionsContext', () => ({
  useAppActions: () => ({ focusChatTab: mockFocusChatTab, jumpToTaskRef: mockJumpToTaskRef }),
}))
vi.mock('../../context/SessionDataContext', () => ({
  useSessionData: () => ({ sessionId: mockSessionId, sessionName: 'own work' }),
}))
vi.mock('../../context/SessionsContext', () => ({
  useSessionsList: () => ({ sessions: mockSessions }),
}))
vi.mock('../../context/ContainerMapContext', () => ({
  useContainerMap: () => ({
    deriveSessionStatus: (sid, sessions) =>
      sessions.find(s => s.session_id === sid)?.status ?? 'none',
  }),
}))
vi.mock('../../context/SessionRoutingContext', () => ({
  useSessionRouting: () => ({ navigateToSession: mockNavigate }),
}))
vi.mock('../../context/StillRunningToastContext', () => ({
  useStillRunningToast: () => ({ showStillRunningToast: mockToast }),
}))
vi.mock('../../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaceId: 'ws-1' }),
}))
vi.mock('../../utils/navigation', () => ({
  openSessionInNewTab: (...args) => mockOpenInNewTab(...args),
}))
vi.mock('./hooks/useSessionSchedules', () => ({
  default: () => mockSchedules,
}))

function scheduleEvents(toolUseId, id, input, at = NOW - 60_000) {
  return [
    {
      type: 'assistant',
      subtype: 'tool_use',
      content: 'CronCreate',
      tool_use_id: toolUseId,
      tool_input: input,
      ts: new Date(at).toISOString(),
    },
    {
      type: 'user',
      subtype: 'tool_result',
      tool_use_id: toolUseId,
      tool_use_result: { id, humanSchedule: input.cron, recurring: input.recurring !== false },
      ts: new Date(at).toISOString(),
    },
  ]
}

function schedule(toolUseId, id, input, at) {
  mockEvents.push(...scheduleEvents(toolUseId, id, input, at))
}

const tabOf = label => screen.getByText(label).closest('button')

describe('CronsPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(NOW)
    vi.stubEnv('TZ', 'UTC')
    mockEvents.length = 0
    mockEventsData.isResuming = false
    mockEventsData.isReplaying = false
    mockEventsData.isResponding = false
    mockEventsData.respondingSince = null
    mockJumpToTaskRef.current = null
    mockSessionId = 'own'
    mockSessions = [{ session_id: 'own', name: 'own work', status: 'running' }]
    mockSchedules = { sources: [], loaded: true, failed: false }
    mockNavigate.mockClear()
    mockToast.mockClear()
    mockOpenInNewTab.mockClear()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('shows the empty state with no schedules', () => {
    render(<CronsPanel />)

    expect(screen.getByTestId('panel-crons')).toHaveTextContent('No scheduled prompts')
  })

  it('shows "Resuming..." while the session loads', () => {
    mockEventsData.isReplaying = true

    render(<CronsPanel />)

    expect(screen.getByTestId('panel-crons')).toHaveTextContent('Resuming...')
  })

  it('lists schedules soonest first with countdown, words, expiry and the prompt first line', () => {
    schedule('c1', '00000001', {
      cron: '20 12 12 10 *',
      prompt: 'Start the batch\nslowly',
      recurring: false,
    })
    schedule('c2', '00000002', { cron: '*/10 * * * *', prompt: 'Check the deploy' })
    vi.setSystemTime(NOW + 30_000)

    render(<CronsPanel />)

    const rows = screen.getAllByTestId('cron-entry')
    expect(rows.map(r => r.querySelector('.cron-when').textContent)).toEqual(['in 10m', 'in 20m'])
    expect(rows[0]).toHaveTextContent('every 10 min · expires Oct 19')
    expect(rows[0]).toHaveTextContent('Check the deploy')
    expect(rows[1]).toHaveTextContent('once, Oct 12 12:20')
    expect(rows[1].querySelector('.cron-prompt').textContent).toBe('Start the batch')
    expect(rows[1].querySelector('.cron-prompt')).toHaveAttribute(
      'title',
      'Start the batch\nslowly',
    )
  })

  it('counts down live and drops a one-time schedule once it fires', () => {
    schedule('c1', '00000001', { cron: '2 12 12 10 *', prompt: 'Soon', recurring: false })
    render(<CronsPanel />)
    expect(screen.getByTestId('cron-entry')).toHaveTextContent('in 2m')

    act(() => {
      vi.advanceTimersByTime(70_000)
    })
    expect(screen.getByTestId('cron-entry')).toHaveTextContent('in 1m')

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(screen.getByTestId('panel-crons')).toHaveTextContent('No scheduled prompts')
  })

  it('shows a schedule that came due mid-turn as due until the turn ends', () => {
    schedule('c1', '00000001', { cron: '1 12 12 10 *', prompt: 'Held', recurring: false })
    mockEventsData.isResponding = true
    mockEventsData.respondingSince = NOW - 30_000
    vi.setSystemTime(NOW + 120_000)

    render(<CronsPanel />)

    const row = screen.getByTestId('cron-entry')
    expect(row.querySelector('.cron-when').textContent).toBe('due')
    expect(row).toHaveClass('cron-due')
    expect(row).toHaveTextContent('once, Oct 12 12:01')
  })

  it('hands the scheduling call to the task jump', async () => {
    vi.useRealTimers()
    const jump = vi.fn()
    mockJumpToTaskRef.current = jump
    mockEvents.push({ type: 'user', subtype: 'text', is_human: true, content: 'go', turn_id: 't1' })
    schedule('c1', '00000001', { cron: '*/10 * * * *', prompt: 'Check' }, Date.now() - 60_000)

    render(<CronsPanel />)
    await userEvent.setup().click(screen.getByTestId('cron-entry'))

    await vi.waitFor(() => expect(jump).toHaveBeenCalledWith({ id: 'c1', turnId: 't1' }))
    expect(mockFocusChatTab).toHaveBeenCalled()
  })

  describe('All sessions', () => {
    const other = (sid, events, respondingSince = null) => ({
      sessionId: sid,
      events,
      respondingSince,
    })
    const human = turnId => ({
      type: 'user',
      subtype: 'text',
      is_human: true,
      turn_id: turnId,
      ts: new Date(NOW - 120_000).toISOString(),
    })

    beforeEach(() => {
      mockSessions = [
        { session_id: 'own', name: 'own work', status: 'running' },
        { session_id: 's2', name: 'docs sweep', status: 'running' },
        { session_id: 's3', name: 'stopping one', status: 'stopping' },
        { session_id: 's4', name: 'no container', status: 'none' },
      ]
    })

    it('counts each tab and lists every running session soonest first, each naming its session', () => {
      schedule('c1', '00000001', { cron: '30 12 12 10 *', prompt: 'Own later', recurring: false })
      mockSchedules.sources = [
        other(
          's2',
          scheduleEvents('c2', '00000002', {
            cron: '10 12 12 10 *',
            prompt: 'Other sooner',
            recurring: false,
          }),
        ),
        other(
          's3',
          scheduleEvents('c3', '00000003', {
            cron: '5 12 12 10 *',
            prompt: 'Stopping',
            recurring: false,
          }),
        ),
        other(
          's4',
          scheduleEvents('c4', '00000004', {
            cron: '6 12 12 10 *',
            prompt: 'Gone',
            recurring: false,
          }),
        ),
      ]

      render(<CronsPanel />)
      expect(tabOf('This session')).toHaveTextContent('1')
      expect(tabOf('All sessions')).toHaveTextContent('2')
      fireEvent.click(tabOf('All sessions'))

      const rows = screen.getAllByTestId('cron-entry')
      expect(rows.map(r => r.querySelector('.cron-prompt').textContent)).toEqual([
        'Other sooner',
        'Own later',
      ])
      expect(rows.map(r => r.querySelector('.cron-session-name').textContent)).toEqual([
        'docs sweep',
        'own work',
      ])
    })

    it("uses the route's copy of the open session only while it replays", () => {
      schedule('c1', '00000001', { cron: '30 12 12 10 *', prompt: 'Live', recurring: false })
      mockSchedules.sources = [
        other(
          'own',
          scheduleEvents('c1', '00000001', {
            cron: '30 12 12 10 *',
            prompt: 'Route copy',
            recurring: false,
          }),
        ),
      ]
      mockSessionId = null
      const { rerender } = render(<CronsPanel />)
      mockSessionId = 'own'
      rerender(<CronsPanel />)
      fireEvent.click(tabOf('All sessions'))
      expect(
        screen.getAllByTestId('cron-entry').map(r => r.querySelector('.cron-prompt').textContent),
      ).toEqual(['Live'])

      mockEventsData.isReplaying = true
      rerender(<CronsPanel />)

      expect(
        screen.getAllByTestId('cron-entry').map(r => r.querySelector('.cron-prompt').textContent),
      ).toEqual(['Route copy'])
    })

    it("shows another session's schedule as due while that session answers", () => {
      mockSessionId = null
      mockSchedules.sources = [
        other(
          's2',
          scheduleEvents(
            'c2',
            '00000002',
            { cron: '59 11 12 10 *', prompt: 'Held', recurring: false },
            NOW - 600_000,
          ),
          NOW - 120_000,
        ),
      ]

      render(<CronsPanel />)

      expect(screen.getByTestId('cron-entry')).toHaveClass('cron-due')
    })

    it('opens another session at the scheduling call, with the toast only while the open one answers', () => {
      mockSchedules.sources = [
        other('s2', [
          human('t9'),
          ...scheduleEvents('c9', '00000009', {
            cron: '30 12 12 10 *',
            prompt: 'Elsewhere',
            recurring: false,
          }),
        ]),
      ]
      const { rerender } = render(<CronsPanel />)
      fireEvent.click(tabOf('All sessions'))

      fireEvent.click(screen.getByTestId('cron-entry'))
      expect(mockNavigate).toHaveBeenCalledWith('ws-1', 's2', {
        turnId: 't9',
        messageType: 'assistant',
        target: 'tool-c9',
      })
      expect(mockToast).not.toHaveBeenCalled()

      mockEventsData.isResponding = true
      rerender(<CronsPanel />)
      fireEvent.click(screen.getByTestId('cron-entry'))
      expect(mockToast).toHaveBeenCalledTimes(1)
    })

    it("hands the open session's own row to the task jump", async () => {
      vi.useRealTimers()
      const jump = vi.fn()
      mockJumpToTaskRef.current = jump
      mockEvents.push(human('t1'))
      schedule('c1', '00000001', { cron: '*/10 * * * *', prompt: 'Mine' }, Date.now() - 60_000)
      render(<CronsPanel />)
      fireEvent.click(tabOf('All sessions'))

      await userEvent.setup().click(screen.getByTestId('cron-entry'))

      await vi.waitFor(() => expect(jump).toHaveBeenCalledWith({ id: 'c1', turnId: 't1' }))
      expect(mockNavigate).not.toHaveBeenCalled()
    })

    it('opens a row in a new tab on Alt+click and middle-click, from either tab', () => {
      mockEvents.push(human('t1'))
      schedule('c1', '00000001', { cron: '30 12 12 10 *', prompt: 'Mine', recurring: false })
      mockSchedules.sources = [
        other('s2', [
          human('t9'),
          ...scheduleEvents('c9', '00000009', {
            cron: '20 12 12 10 *',
            prompt: 'Theirs',
            recurring: false,
          }),
        ]),
      ]
      render(<CronsPanel />)

      fireEvent.click(screen.getByTestId('cron-entry'), { altKey: true })
      expect(mockOpenInNewTab).toHaveBeenLastCalledWith('ws-1', 'own', {
        turnId: 't1',
        messageType: 'assistant',
        target: 'tool-c1',
      })

      fireEvent.click(tabOf('All sessions'))
      const [theirs] = screen.getAllByTestId('cron-entry')
      fireEvent(theirs, new MouseEvent('auxclick', { bubbles: true, button: 1 }))
      expect(mockOpenInNewTab).toHaveBeenLastCalledWith('ws-1', 's2', {
        turnId: 't9',
        messageType: 'assistant',
        target: 'tool-c9',
      })
      expect(theirs).toHaveClass('cron-entry-opening')
    })

    it('keeps "Resuming..." on This session while All sessions lists the others', () => {
      mockEventsData.isResuming = true
      mockSchedules.sources = [
        other(
          's2',
          scheduleEvents('c2', '00000002', {
            cron: '30 12 12 10 *',
            prompt: 'Theirs',
            recurring: false,
          }),
        ),
      ]
      render(<CronsPanel />)
      expect(screen.getByTestId('panel-crons')).toHaveTextContent('Resuming...')

      fireEvent.click(tabOf('All sessions'))

      expect(screen.getByTestId('panel-crons')).not.toHaveTextContent('Resuming...')
      expect(screen.getByTestId('cron-entry')).toHaveTextContent('Theirs')
    })

    it('says "Loading..." before the first answer and names a failure instead of an empty list', () => {
      mockSessionId = null
      mockSchedules = { sources: [], loaded: false, failed: false }
      const { rerender } = render(<CronsPanel />)
      expect(screen.getByTestId('panel-crons')).toHaveTextContent('Loading...')

      mockSchedules = { sources: [], loaded: false, failed: true }
      rerender(<CronsPanel />)

      expect(screen.getByTestId('panel-crons')).toHaveTextContent(
        "Could not load other sessions' schedules",
      )
      expect(screen.getByTestId('panel-crons')).not.toHaveTextContent('No scheduled prompts')
    })

    it("keeps the open session's rows beside the failure line", () => {
      schedule('c1', '00000001', { cron: '30 12 12 10 *', prompt: 'Mine', recurring: false })
      mockSchedules = { sources: [], loaded: false, failed: true }
      render(<CronsPanel />)
      fireEvent.click(tabOf('All sessions'))

      expect(screen.getByTestId('cron-entry')).toHaveTextContent('Mine')
      expect(screen.getByTestId('panel-crons')).toHaveTextContent(
        "Could not load other sessions' schedules",
      )
    })
  })

  describe('reactive tab', () => {
    it('opens on "All sessions" without a session and "This session" with one', () => {
      mockSessionId = null
      const { rerender } = render(<CronsPanel />)
      expect(tabOf('All sessions')).toHaveClass('active')

      mockSessionId = 'own'
      rerender(<CronsPanel />)
      expect(tabOf('This session')).toHaveClass('active')
    })

    it('starts on "This session" when a session is open at mount', () => {
      render(<CronsPanel />)

      expect(tabOf('This session')).toHaveClass('active')
    })

    it('moves to "All sessions" when the last session closes', () => {
      const { rerender } = render(<CronsPanel />)

      mockSessionId = null
      rerender(<CronsPanel />)

      expect(tabOf('All sessions')).toHaveClass('active')
    })

    it('a tab picked by hand holds until the session changes', () => {
      const { rerender } = render(<CronsPanel />)
      fireEvent.click(tabOf('All sessions'))
      rerender(<CronsPanel />)
      expect(tabOf('All sessions')).toHaveClass('active')

      mockSessionId = 's2'
      rerender(<CronsPanel />)

      expect(tabOf('This session')).toHaveClass('active')
    })
  })
})
