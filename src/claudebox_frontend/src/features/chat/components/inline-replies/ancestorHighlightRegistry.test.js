/** Tests for the ancestor highlight registry - the union coordinator across mounted ancestors. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// jsdom has no CSS Custom Highlight API and the module feature-detects once at import, so the
// stubs must exist before it evaluates - hence resetModules plus a fresh dynamic import.
class FakeHighlight {
  constructor(...ranges) {
    this.ranges = ranges
  }
}

function fakeRange(id) {
  return { id }
}

describe('ancestorHighlightRegistry', () => {
  let highlightsSet
  let registry
  let ANCESTOR_HIGHLIGHT_NAME

  beforeEach(async () => {
    highlightsSet = new Map()
    globalThis.Highlight = FakeHighlight
    globalThis.CSS = {
      highlights: {
        set: vi.fn((name, highlight) => highlightsSet.set(name, highlight)),
        delete: vi.fn(name => highlightsSet.delete(name)),
      },
    }

    vi.resetModules()
    registry = await import('./ancestorHighlightRegistry')
    ANCESTOR_HIGHLIGHT_NAME = registry.ANCESTOR_HIGHLIGHT_NAME
  })

  afterEach(() => {
    delete globalThis.Highlight
    delete globalThis.CSS
  })

  it('paints one contributor under the shared name', () => {
    const ranges = [fakeRange('a'), fakeRange('b')]

    registry.setAncestorHighlightRanges('anc-1', ranges)

    const highlight = highlightsSet.get(ANCESTOR_HIGHLIGHT_NAME)
    expect(highlight.ranges).toEqual(ranges)
  })

  it('unions two contributors under the same name rather than overwriting one another', () => {
    registry.setAncestorHighlightRanges('anc-1', [fakeRange('a')])
    registry.setAncestorHighlightRanges('anc-2', [fakeRange('b'), fakeRange('c')])

    const highlight = highlightsSet.get(ANCESTOR_HIGHLIGHT_NAME)
    expect(highlight.ranges).toHaveLength(3)
  })

  it('replacing one contributor leaves the other contributor union intact', () => {
    registry.setAncestorHighlightRanges('anc-1', [fakeRange('a')])
    registry.setAncestorHighlightRanges('anc-2', [fakeRange('b')])

    registry.setAncestorHighlightRanges('anc-1', [fakeRange('a2')])

    const highlight = highlightsSet.get(ANCESTOR_HIGHLIGHT_NAME)
    expect(highlight.ranges.map(r => r.id)).toEqual(['a2', 'b'])
  })

  it('clearing a contributor removes only its own ranges from the union', () => {
    registry.setAncestorHighlightRanges('anc-1', [fakeRange('a')])
    registry.setAncestorHighlightRanges('anc-2', [fakeRange('b')])

    registry.clearAncestorHighlightRanges('anc-1')

    const highlight = highlightsSet.get(ANCESTOR_HIGHLIGHT_NAME)
    expect(highlight.ranges.map(r => r.id)).toEqual(['b'])
  })

  it('deletes the highlight name entirely once every contributor is empty', () => {
    registry.setAncestorHighlightRanges('anc-1', [fakeRange('a')])

    registry.setAncestorHighlightRanges('anc-1', [])

    expect(highlightsSet.has(ANCESTOR_HIGHLIGHT_NAME)).toBe(false)
  })

  it('setting an empty range array is equivalent to clearing that contributor', () => {
    registry.setAncestorHighlightRanges('anc-1', [fakeRange('a')])
    registry.setAncestorHighlightRanges('anc-2', [fakeRange('b')])

    registry.setAncestorHighlightRanges('anc-1', [])

    const highlight = highlightsSet.get(ANCESTOR_HIGHLIGHT_NAME)
    expect(highlight.ranges.map(r => r.id)).toEqual(['b'])
  })
})
