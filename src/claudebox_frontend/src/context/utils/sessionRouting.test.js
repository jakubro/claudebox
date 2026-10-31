/** Tests for the session hash route's turn and part segments. */

import { describe, expect, it } from 'vitest'
import { buildTurnSegment, parseHash } from './sessionRouting'

const SESSION = '#/workspaces/ws/sessions/s1'

describe('session route part segment', () => {
  it.each([['p-evt_002-0-1'], ['tool-toolu_01AbC']])(
    'round-trips an assistant turn carrying %s',
    part => {
      const hash = `${SESSION}${buildTurnSegment('turn_1', 'assistant', part)}`

      expect(hash).toBe(`${SESSION}/turns/a-turn_1/${part}`)
      expect(parseHash(hash)).toMatchObject({
        sessionId: 's1',
        turnId: 'turn_1',
        messageType: 'assistant',
        target: part,
      })
    },
  )

  it('keeps the plain turn forms unchanged', () => {
    expect(buildTurnSegment('turn_1', 'user')).toBe('/turns/u-turn_1')
    expect(buildTurnSegment('turn_1', 'assistant')).toBe('/turns/a-turn_1')
    expect(parseHash(`${SESSION}/turns/u-turn_1`)).toMatchObject({
      turnId: 'turn_1',
      messageType: 'user',
      target: null,
    })
  })

  it('never puts a part on a user segment', () => {
    expect(buildTurnSegment('turn_1', 'user', 'p-evt-0-1')).toBe('/turns/u-turn_1')
    expect(parseHash(`${SESSION}/turns/u-turn_1/p-evt-0-1`)).toMatchObject({ target: null })
  })

  it('rejects a part segment outside the key alphabet', () => {
    expect(parseHash(`${SESSION}/turns/a-turn_1/p-evt.0-1`)).toBeNull()
  })
})
