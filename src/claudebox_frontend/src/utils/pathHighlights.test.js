/** Tests for pathHighlights - resolving path candidates found in free text. */

import { describe, expect, it } from 'vitest'
import { computeHighlights } from './pathHighlights'

describe('computeHighlights', () => {
  it('includes only candidates that resolve, dropping unresolvable ones', () => {
    const text = 'see foo.js and bar.js for details'
    const resolvedPaths = { 'foo.js': '/abs/foo.js' }

    const highlights = computeHighlights(text, null, resolvedPaths)

    expect(highlights).toHaveLength(1)
    expect(highlights[0]).toMatchObject({ candidate: 'foo.js', resolved: '/abs/foo.js' })
  })

  it('returns no highlights when nothing in the text resolves', () => {
    const text = 'see foo.js for details'

    expect(computeHighlights(text, null, {})).toEqual([])
  })

  it('resolves /tmp paths relative to the session directory without a resolvedPaths entry', () => {
    const text = 'wrote output to /tmp/build.log'

    const highlights = computeHighlights(text, '/sessions/s1', {})

    expect(highlights).toHaveLength(1)
    expect(highlights[0]).toMatchObject({
      candidate: '/tmp/build.log',
      resolved: '/sessions/s1/tmp/build.log',
    })
  })
})
