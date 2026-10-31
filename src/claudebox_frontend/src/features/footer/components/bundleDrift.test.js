/** Tests for driftedKeys - which of a bundle's declared starting values a session has left. */

import { describe, expect, it } from 'vitest'
import { driftedKeys } from './bundleDrift'

describe('driftedKeys', () => {
  it('names a declared value the session no longer runs', () => {
    expect(
      driftedKeys(
        { model: 'claude-opus-5-5', effort_level: 'max' },
        { model: 'claude-sonnet-5', effort_level: 'max' },
      ),
    ).toEqual(['model'])
  })

  it('is empty once the value is set back', () => {
    expect(driftedKeys({ model: 'claude-opus-5-5' }, { model: 'claude-opus-5-5' })).toEqual([])
  })

  it('ignores values the session has not reported yet', () => {
    expect(
      driftedKeys({ model: 'claude-opus-5-5', session_prompt: 'Be brief.' }, { model: null }),
    ).toEqual([])
  })

  it('never drifts for a bundle that declared nothing seeded', () => {
    expect(driftedKeys({}, { model: 'claude-sonnet-5' })).toEqual([])
  })

  it('never drifts without session data', () => {
    expect(driftedKeys({ model: 'claude-opus-5-5' }, null)).toEqual([])
  })
})
