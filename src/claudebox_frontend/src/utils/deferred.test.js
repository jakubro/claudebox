/** Tests for createDeferred. */

import { describe, expect, it } from 'vitest'
import { createDeferred } from './deferred'

describe('createDeferred', () => {
  it('resolves the promise when resolve is called', async () => {
    const deferred = createDeferred()

    deferred.resolve('value')

    await expect(deferred.promise).resolves.toBe('value')
  })

  it('rejects the promise when reject is called', async () => {
    const deferred = createDeferred()
    const error = new Error('failed')

    deferred.reject(error)

    await expect(deferred.promise).rejects.toBe(error)
  })

  it('returns a distinct promise per call', () => {
    const first = createDeferred()
    const second = createDeferred()

    expect(first.promise).not.toBe(second.promise)
  })
})
