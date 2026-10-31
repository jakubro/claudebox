/** Tests for threadEvents - a side thread's own events, arranged into one turn per exchange. */

import { describe, expect, it } from 'vitest'
import {
  arrangeThreadEvents,
  countExchanges,
  deriveThreadTurns,
  openingExchange,
  threadOwnEvents,
} from './threadEvents'

const forkDivider = (parentId = 'source-session') => ({
  type: 'system',
  subtype: 'container_restarted',
  message_data: { fork_parent_session_id: parentId },
})
const ask = (content, turnId = null) => ({ type: 'user', is_human: true, content, turn_id: turnId })
const say = (content, turnId = null) => ({
  type: 'assistant',
  subtype: 'text',
  content,
  turn_id: turnId,
})

function layout(events, pending = [], quote = null) {
  return deriveThreadTurns(events, pending, quote).turns.map(turn => [
    turn.userMessage,
    ...turn.events.map(e => e.content),
  ])
}

describe('threadOwnEvents', () => {
  it('a divider mid-way keeps only what follows it', () => {
    const events = [ask('inherited question'), say('inherited answer'), forkDivider(), ask('own')]

    expect(threadOwnEvents(events)).toEqual([ask('own')])
  })

  it('a divider at the very top keeps everything after it', () => {
    expect(threadOwnEvents([forkDivider(), ask('own'), say('answer')])).toEqual([
      ask('own'),
      say('answer'),
    ])
  })

  it('no divider keeps everything', () => {
    const events = [ask('q1'), say('a1')]

    expect(threadOwnEvents(events)).toEqual(events)
  })

  it('a plain restart divider naming no source conversation is not a seam', () => {
    const restart = { type: 'system', subtype: 'container_restarted', message_data: null }

    expect(threadOwnEvents([restart, ask('q1')])).toEqual([restart, ask('q1')])
  })

  it('a fork of a fork: the LAST divider is the seam', () => {
    const events = [
      forkDivider('ancestor'),
      ask('inherited from the ancestor'),
      forkDivider('this'),
      ask('own'),
    ]

    expect(threadOwnEvents(events)).toEqual([ask('own')])
  })
})

describe('arrangeThreadEvents', () => {
  it('returns echoed exchanges unchanged when nothing is pending or out of order', () => {
    const events = [ask('q1', 't1'), say('a1', 't1'), ask('q2', 't2'), say('a2', 't2')]

    expect(arrangeThreadEvents(events, [])).toEqual(events)
  })

  it('an event naming an earlier exchange joins it, not the latest one', () => {
    const events = [ask('q1', 't1'), ask('q2', 't2'), say('late for q1', 't1'), say('a2', 't2')]

    expect(layout(events)).toEqual([
      ['q1', 'late for q1'],
      ['q2', 'a2'],
    ])
  })

  it('a question not yet echoed stands in where it was asked, and holds what arrives after', () => {
    const events = [ask('q1', 't1'), say('a1', 't1'), say('after the ask')]

    expect(layout(events, [{ content: 'q2', at: 2 }])).toEqual([
      ['q1', 'a1'],
      ['q2', 'after the ask'],
    ])
  })

  it('an unechoed question asked after every arrived event closes the list', () => {
    expect(layout([ask('q1', 't1'), say('a1', 't1')], [{ content: 'q2', at: 2 }])).toEqual([
      ['q1', 'a1'],
      ['q2'],
    ])
  })

  it("a subagent's own prompt does not open an exchange", () => {
    const nested = { ...ask('subagent prompt', 't1'), parent_tool_use_id: 'tool_1' }

    expect(deriveThreadTurns([ask('q1', 't1'), nested, say('a1', 't1')], []).turns).toHaveLength(1)
  })
})

describe('deriveThreadTurns given the quote', () => {
  const QUOTE = 'context window'

  it('draws an echoed first question without its quote block', () => {
    const events = [ask('> context window\n\nwhy this branch?', 't1'), say('a1', 't1')]

    expect(layout(events, [], QUOTE)).toEqual([['why this branch?', 'a1']])
    expect(events[0].content).toBe('> context window\n\nwhy this branch?')
  })

  it('draws a first question still pending without its quote block', () => {
    expect(layout([], [{ content: '> context window\n\nwhy?', at: 0 }], QUOTE)).toEqual([['why?']])
  })

  it('removes a multi-line quote whole, its empty lines included', () => {
    const events = [ask('> if (a) {\n>\n>   b()\n\nexplain', 't1')]

    expect(layout(events, [], 'if (a) {\n\n  b()')).toEqual([['explain']])
  })

  it('leaves a first question that does not start with the quote block as sent', () => {
    expect(layout([ask('why this branch?', 't1')], [], QUOTE)).toEqual([['why this branch?']])
  })

  it('leaves a later question starting with the same block as sent', () => {
    const events = [ask('> context window\n\nq1', 't1'), ask('> context window\n\nq2', 't2')]

    expect(layout(events, [], QUOTE)).toEqual([['q1'], ['> context window\n\nq2']])
  })

  it('draws every question as sent when no quote is given', () => {
    expect(layout([ask('> context window\n\nq1', 't1')])).toEqual([['> context window\n\nq1']])
  })
})

describe('countExchanges', () => {
  it('does not count an echoed task notification, which the transcript hides', () => {
    const echo = ask('<task-notification><task-id>t1</task-id></task-notification>')

    expect(countExchanges([ask('q1'), echo], [])).toBe(1)
  })

  it('counts echoed questions and pending ones, not subagent prompts', () => {
    const nested = { ...ask('subagent prompt'), parent_tool_use_id: 'tool_1' }

    expect(countExchanges([ask('q1'), nested, say('a1')], [{ content: 'q2', at: 3 }])).toBe(2)
  })
})

describe('openingExchange', () => {
  it('keeps the first own exchange and drops every later one', () => {
    const events = [ask('inherited'), forkDivider(), ask('q1'), say('a1'), ask('q2'), say('a2')]

    expect(openingExchange(events)).toEqual([ask('q1'), say('a1')])
  })

  it('a thread with one exchange keeps all of it', () => {
    expect(openingExchange([ask('q1'), say('a1')])).toEqual([ask('q1'), say('a1')])
  })
})
