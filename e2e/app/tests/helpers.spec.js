/** Unit tests for pure helpers in helpers.js - no browser needed. */

import { expect, test } from '@playwright/test'
import { resolveOpsPayload } from '../helpers.js'

test.describe('resolveOpsPayload', () => {
  test('rejects a __proto__ path segment instead of polluting Object.prototype', () => {
    const payload = { session: [{ op: 'set', path: '__proto__.polluted', value: true }] }

    expect(() => resolveOpsPayload(payload)).toThrow(/unsafe path segment/)
    expect({}.polluted).toBeUndefined()
  })

  test('rejects constructor and prototype path segments the same way', () => {
    expect(() =>
      resolveOpsPayload({ session: [{ op: 'set', path: 'a.constructor.b', value: 1 }] }),
    ).toThrow(/unsafe path segment/)
    expect(() =>
      resolveOpsPayload({ session: [{ op: 'set', path: 'a.prototype.b', value: 1 }] }),
    ).toThrow(/unsafe path segment/)
  })

  test('still resolves an ordinary nested path', () => {
    const payload = { session: [{ op: 'set', path: 'stash.pinned', value: true }] }

    expect(resolveOpsPayload(payload)).toEqual({ session: { stash: { pinned: true } } })
  })
})
