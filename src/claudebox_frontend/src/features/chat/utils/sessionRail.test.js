/** Tests for pure session rail derivation - ancestry walk, depth cap, walked-back tail. */

import { beforeEach, describe, expect, it } from 'vitest'
import { CHAT_RAIL_MAX_DEPTH } from '../../../config/dimensions'
import {
  capAncestors,
  deriveAncestorChain,
  deriveVisitedPath,
  railTailStorageKey,
  readStoredPath,
  writeStoredPath,
} from './sessionRail'

function session(id, parentId = null, isSideThread = false) {
  return { session_id: id, parent_session_id: parentId, is_side_thread: isSideThread }
}

describe('railTailStorageKey', () => {
  it('namespaces the key by root session id', () => {
    expect(railTailStorageKey('root-1')).toBe('chat-rail-tail:root-1')
  })
})

describe('readStoredPath / writeStoredPath', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('round-trips a written path', () => {
    writeStoredPath('k', ['a', 'b'])
    expect(readStoredPath('k')).toEqual(['a', 'b'])
  })

  it('reads a missing key as an empty array', () => {
    expect(readStoredPath('missing-key')).toEqual([])
  })

  it('reads malformed JSON as an empty array rather than throwing', () => {
    sessionStorage.setItem('k', 'not json')
    expect(readStoredPath('k')).toEqual([])
  })

  it('reads a non-array JSON value as an empty array', () => {
    sessionStorage.setItem('k', JSON.stringify({ not: 'an array' }))
    expect(readStoredPath('k')).toEqual([])
  })
})

describe('deriveAncestorChain', () => {
  it('returns empty for no focused session', () => {
    expect(deriveAncestorChain([], null)).toEqual([])
    expect(deriveAncestorChain([session('a')], undefined)).toEqual([])
  })

  it('returns a single-entry chain for a session with no parent', () => {
    const sessions = [session('root')]
    expect(deriveAncestorChain(sessions, 'root')).toEqual(['root'])
  })

  it('walks drill-down hops root-first, ending at the focused session', () => {
    const sessions = [session('root'), session('mid', 'root', true), session('leaf', 'mid', true)]
    expect(deriveAncestorChain(sessions, 'leaf')).toEqual(['root', 'mid', 'leaf'])
  })

  it('stops the walk at a parent missing from the fetched list, keeping its id', () => {
    // 'mid' claims parent 'ghost', which is not in `sessions` - the walk cannot go further.
    const sessions = [session('mid', 'ghost', true), session('leaf', 'mid', true)]
    expect(deriveAncestorChain(sessions, 'leaf')).toEqual(['ghost', 'mid', 'leaf'])
  })

  it('includes a parent with no turns and no container, unlike a sessions-panel-filtered tree', () => {
    const sessions = [
      session('root'),
      session('quiet-parent', 'root', true),
      session('leaf', 'quiet-parent', true),
    ]
    expect(deriveAncestorChain(sessions, 'leaf')).toEqual(['root', 'quiet-parent', 'leaf'])
  })

  it('a fork of a root yields the fork alone', () => {
    const sessions = [session('root'), session('fork', 'root', false)]
    expect(deriveAncestorChain(sessions, 'fork')).toEqual(['fork'])
  })

  it("a fork of a side conversation yields the side conversation's own parent plus the fork, in that order", () => {
    const sessions = [
      session('root'),
      session('thread', 'root', true),
      session('fork', 'thread', false),
    ]
    expect(deriveAncestorChain(sessions, 'fork')).toEqual(['root', 'fork'])
  })

  it('a chain mixing both kinds yields only the parents of a drill-down hop, plus the focused session', () => {
    // thread-1 and thread-2 are side conversations, invisible themselves; 'fork' - an ordinary
    // rewind made inside thread-1 - takes thread-1's slot because thread-2 drilled down from it.
    const sessions = [
      session('root'),
      session('thread-1', 'root', true),
      session('fork', 'thread-1', false),
      session('thread-2', 'fork', true),
    ]
    expect(deriveAncestorChain(sessions, 'thread-2')).toEqual(['root', 'fork', 'thread-2'])
  })

  it('a fork whose source is missing yields the fork alone rather than throwing', () => {
    const sessions = [session('fork', 'missing-source', false)]
    expect(() => deriveAncestorChain(sessions, 'fork')).not.toThrow()
    expect(deriveAncestorChain(sessions, 'fork')).toEqual(['fork'])
  })
})

describe('capAncestors', () => {
  it('returns every ancestor when the chain is within the cap', () => {
    const chain = ['root', 'mid', 'leaf']
    expect(capAncestors(chain)).toEqual(['root', 'mid'])
  })

  it('keeps the root and the nearest ancestors once the chain exceeds the cap', () => {
    const chain = Array.from({ length: 8 }, (_, i) => `s${i}`) // s0..s6 ancestors, s7 focused
    const result = capAncestors(chain)

    expect(result.length).toBe(CHAT_RAIL_MAX_DEPTH - 1)
    expect(result[0]).toBe('s0') // root always kept
    expect(result[result.length - 1]).toBe('s6') // nearest to focus always kept
  })

  it('drops the middle of a long chain, not the root or the nearest ancestor', () => {
    const chain = Array.from({ length: 8 }, (_, i) => `s${i}`)
    const result = capAncestors(chain)

    expect(result).not.toContain('s3')
  })

  it('a rail of one (no ancestors) caps to an empty list', () => {
    expect(capAncestors(['leaf'])).toEqual([])
  })
})

describe('deriveVisitedPath', () => {
  it('with no stored path, the visited path is the chain itself and the tail is empty', () => {
    const chain = ['root', 'child']
    const { visitedPath, tail } = deriveVisitedPath(chain, [])

    expect(visitedPath).toEqual(['root', 'child'])
    expect(tail).toEqual([])
  })

  it('walking back to a stored ancestor preserves the tail beyond it', () => {
    const stored = ['root', 'child', 'grandchild']
    const chain = ['root', 'child'] // focus moved back to 'child'
    const { visitedPath, tail } = deriveVisitedPath(chain, stored)

    expect(visitedPath).toEqual(stored)
    expect(tail).toEqual(['grandchild'])
  })

  it('re-focusing forward along a known path leaves it unchanged', () => {
    const stored = ['root', 'child', 'grandchild']
    const chain = ['root', 'child', 'grandchild']
    const { visitedPath, tail } = deriveVisitedPath(chain, stored)

    expect(visitedPath).toEqual(stored)
    expect(tail).toEqual([])
  })

  it('drilling into a new child from the deepest known point extends the path', () => {
    const stored = ['root', 'child']
    const chain = ['root', 'child', 'grandchild'] // drilled from 'child'
    const { visitedPath, tail } = deriveVisitedPath(chain, stored)

    expect(visitedPath).toEqual(['root', 'child', 'grandchild'])
    expect(tail).toEqual([])
  })

  it('drilling into a different child after walking back truncates the old branch', () => {
    const stored = ['root', 'child', 'old-grandchild']
    const chain = ['root', 'child', 'new-grandchild'] // walked back to 'child', drilled elsewhere
    const { visitedPath, tail } = deriveVisitedPath(chain, stored)

    expect(visitedPath).toEqual(['root', 'child', 'new-grandchild'])
    expect(visitedPath).not.toContain('old-grandchild')
    expect(tail).toEqual([])
  })

  it('a fresh session unrelated to the stored path resets it to the chain', () => {
    const stored = ['other-root', 'other-child']
    const chain = ['root', 'unrelated-leaf']
    const { visitedPath, tail } = deriveVisitedPath(chain, stored)

    expect(visitedPath).toEqual(chain)
    expect(tail).toEqual([])
  })

  it('tolerates a malformed stored value as an empty path', () => {
    const chain = ['root']
    const { visitedPath, tail } = deriveVisitedPath(chain, null)

    expect(visitedPath).toEqual(['root'])
    expect(tail).toEqual([])
  })
})
