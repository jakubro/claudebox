/** Tests for notifications.js helper functions. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildNotificationTitle,
  finishedRunOrigin,
  getResponsePreview,
  requestNotificationPermission,
  setTitleIndicator,
} from './notifications'

describe('getResponsePreview', () => {
  it('returns last assistant text content', () => {
    const events = [{ type: 'assistant', subtype: 'text', content: 'Hello world' }]
    expect(getResponsePreview(events)).toBe('Hello world')
  })

  it('truncates long text to 50 chars', () => {
    const long = 'a'.repeat(80)
    const events = [{ type: 'assistant', subtype: 'text', content: long }]

    expect(getResponsePreview(events)).toBe(`${'a'.repeat(50)}...`)
  })

  it('skips thinking blocks', () => {
    const events = [
      { type: 'assistant', subtype: 'thinking', content: 'thinking...' },
      { type: 'assistant', subtype: 'text', content: 'Answer' },
    ]
    expect(getResponsePreview(events)).toBe('Answer')
  })

  it('returns default when no assistant text events', () => {
    expect(getResponsePreview([])).toBe('Response complete')
  })

  it('uses last assistant text event (not first)', () => {
    const events = [
      { type: 'assistant', subtype: 'text', content: 'First' },
      { type: 'assistant', subtype: 'text', content: 'Last' },
    ]
    expect(getResponsePreview(events)).toBe('Last')
  })
})

describe('buildNotificationTitle', () => {
  it('builds title with session name and workspace', () => {
    expect(buildNotificationTitle('Session 1', '/home/user/project')).toBe(
      'Session 1 | project | Claudebox',
    )
  })

  it('builds title with only Claudebox when no session or workspace', () => {
    expect(buildNotificationTitle(null, null)).toBe('Claudebox')
  })

  it('builds title with session name only', () => {
    expect(buildNotificationTitle('My Session', null)).toBe('My Session | Claudebox')
  })

  it('builds title with workspace only', () => {
    expect(buildNotificationTitle(null, '/home/user/project')).toBe('project | Claudebox')
  })
})

describe('requestNotificationPermission', () => {
  const originalNotification = global.Notification

  afterEach(() => {
    global.Notification = originalNotification
  })

  it('returns denied when Notification API not available', async () => {
    delete global.Notification
    const result = await requestNotificationPermission()
    expect(result).toBe('denied')
  })

  it('returns granted when already granted', async () => {
    global.Notification = { permission: 'granted', requestPermission: vi.fn() }
    const result = await requestNotificationPermission()
    expect(result).toBe('granted')
  })

  it('requests permission when status is default', async () => {
    global.Notification = {
      permission: 'default',
      requestPermission: vi.fn().mockResolvedValue('granted'),
    }
    const result = await requestNotificationPermission()
    expect(result).toBe('granted')
    expect(Notification.requestPermission).toHaveBeenCalledOnce()
  })

  it('returns denied when already denied without asking', async () => {
    global.Notification = { permission: 'denied', requestPermission: vi.fn() }
    const result = await requestNotificationPermission()
    expect(result).toBe('denied')
    expect(Notification.requestPermission).not.toHaveBeenCalled()
  })
})

describe('setTitleIndicator', () => {
  beforeEach(() => {
    document.title = 'Claudebox'
  })

  it('adds asterisk prefix when indicator is true', () => {
    setTitleIndicator(true)
    expect(document.title).toBe('* Claudebox')
  })

  it('removes asterisk prefix when indicator is false', () => {
    document.title = '* Claudebox'
    setTitleIndicator(false)
    expect(document.title).toBe('Claudebox')
  })

  it('does not double-add prefix', () => {
    document.title = '* Claudebox'
    setTitleIndicator(true)
    expect(document.title).toBe('* Claudebox')
  })

  it('does nothing when removing prefix that does not exist', () => {
    setTitleIndicator(false)
    expect(document.title).toBe('Claudebox')
  })
})

describe('finishedRunOrigin', () => {
  const user = (content = 'go') => ({ type: 'user', subtype: 'message', is_human: true, content })
  const reply = { type: 'assistant', subtype: 'text', content: 'ok' }
  const result = { type: 'result', subtype: 'success' }
  const sibling = { type: 'system', subtype: 'sibling_message', content: 'Done.' }
  const taskNotification = { type: 'system', subtype: 'task_notification' }
  const tool = name => ({ type: 'assistant', subtype: 'tool_use', tool_name: name })

  it.each([
    ['a run the user started', [user(), reply, result], false],
    [
      'a run a sibling message started after an idle turn',
      [user(), reply, result, sibling, reply, result],
      true,
    ],
    [
      'a sibling message delivered mid-run and run afterwards',
      [user(), reply, sibling, result, reply, result],
      true,
    ],
    [
      'the user typing during a sibling run',
      [user(), reply, result, sibling, reply, user('stop'), result],
      false,
    ],
    ['a task notification run', [user(), reply, result, taskNotification, reply, result], false],
    ['a sibling run with no reply of its own', [user(), reply, result, sibling, result], true],
  ])('%s', (_name, events, fromSibling) => {
    expect(finishedRunOrigin(events).fromSibling).toBe(fromSibling)
  })

  it.each(['mcp__claudebox__needs_user', 'needs_user', 'AskUserQuestion', 'ExitPlanMode'])(
    'a run calling %s asks the user',
    name => {
      expect(finishedRunOrigin([user(), tool(name), result]).asksUser).toBe(true)
    },
  )

  it('an ask in an earlier run does not count', () => {
    const events = [user(), tool('needs_user'), result, sibling, reply, result]

    expect(finishedRunOrigin(events)).toEqual({ fromSibling: true, asksUser: false })
  })

  it("ignores a subagent's own events", () => {
    const nested = { ...sibling, parent_tool_use_id: 'tu_1' }

    expect(finishedRunOrigin([user(), reply, result, nested, reply, result]).fromSibling).toBe(
      false,
    )
  })

  it('reports nothing before any run finished', () => {
    expect(finishedRunOrigin([user(), reply])).toEqual({ fromSibling: false, asksUser: false })
  })
})
