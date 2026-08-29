/** Tests for mountTurn - windowed-turn DOM resolution and frame-polling. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { findTurnEl, findTurnRow, pollFrames, withMountedTurn } from './mountTurn'

describe('findTurnEl / findTurnRow', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('finds an element by turn id, escaping special characters', () => {
    document.body.innerHTML = '<div data-turn-id="a:b"></div>'
    expect(findTurnEl('a:b')).not.toBeNull()
  })

  it('returns null when no element matches the turn id', () => {
    expect(findTurnEl('missing')).toBeNull()
  })

  it('finds a windowed row by its virtual index', () => {
    document.body.innerHTML = '<div class="historical-turn-row" data-index="3"></div>'
    expect(findTurnRow(3)).not.toBeNull()
  })

  it('returns null when no row matches the index', () => {
    expect(findTurnRow(99)).toBeNull()
  })

  it('finds a row under a caller-supplied selector', () => {
    document.body.innerHTML = '<div class="terminal-entry" data-index="2"></div>'
    expect(findTurnRow(2, '.terminal-entry')).not.toBeNull()
    expect(findTurnRow(2, '.historical-turn-row')).toBeNull()
  })
})

describe('pollFrames', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', cb => {
      cb()
      return 0
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves immediately when found on the first attempt, without scheduling a frame', () => {
    const rafSpy = vi.spyOn(global, 'requestAnimationFrame')
    const onResolved = vi.fn()

    pollFrames(5, () => 'found-it', onResolved)

    expect(onResolved).toHaveBeenCalledWith('found-it')
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('gives up immediately when frames is exhausted from the start', () => {
    const rafSpy = vi.spyOn(global, 'requestAnimationFrame')
    const onResolved = vi.fn()

    pollFrames(0, () => null, onResolved)

    expect(onResolved).toHaveBeenCalledWith(null)
    expect(rafSpy).not.toHaveBeenCalled()
  })

  it('polls across frames and resolves once the target appears', () => {
    let attempts = 0
    const resolve = () => {
      attempts += 1
      return attempts >= 3 ? 'landed' : null
    }
    const onResolved = vi.fn()

    pollFrames(5, resolve, onResolved)

    expect(attempts).toBe(3)
    expect(onResolved).toHaveBeenCalledWith('landed')
  })

  it('reports null once every frame is exhausted without a find', () => {
    const onResolved = vi.fn()

    pollFrames(3, () => null, onResolved)

    expect(onResolved).toHaveBeenCalledWith(null)
    expect(onResolved).toHaveBeenCalledTimes(1)
  })
})

describe('withMountedTurn', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('resolves immediately with an already-mounted turn element', () => {
    document.body.innerHTML = '<div data-turn-id="t1"></div>'
    const virtualizer = { scrollToIndex: vi.fn() }
    const onResolved = vi.fn()

    withMountedTurn({ turnId: 't1', turns: [], virtualizer, onResolved })

    expect(onResolved).toHaveBeenCalledWith(document.querySelector('[data-turn-id="t1"]'))
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('resolves null when the turn is not in the turns list', () => {
    const virtualizer = { scrollToIndex: vi.fn() }
    const onResolved = vi.fn()

    withMountedTurn({ turnId: 'missing', turns: [{ turn_id: 't1' }], virtualizer, onResolved })

    expect(onResolved).toHaveBeenCalledWith(null)
    expect(virtualizer.scrollToIndex).not.toHaveBeenCalled()
  })

  it('resolves null when there is no virtualizer, even if the turn is in range', () => {
    const onResolved = vi.fn()

    withMountedTurn({ turnId: 't1', turns: [{ turn_id: 't1' }], virtualizer: null, onResolved })

    expect(onResolved).toHaveBeenCalledWith(null)
  })

  it('asks the virtualizer to scroll to the index, then polls until the turn mounts', () => {
    vi.stubGlobal('requestAnimationFrame', cb => {
      // Simulate the element mounting between the scroll request and the next frame.
      document.body.innerHTML = '<div data-turn-id="t1"></div>'
      cb()
      return 0
    })
    const virtualizer = { scrollToIndex: vi.fn() }
    const onResolved = vi.fn()

    withMountedTurn({
      turnId: 't1',
      turns: [{ turn_id: 't0' }, { turn_id: 't1' }],
      virtualizer,
      onResolved,
    })

    expect(virtualizer.scrollToIndex).toHaveBeenCalledWith(1, { align: 'start' })
    expect(onResolved).toHaveBeenCalledWith(document.querySelector('[data-turn-id="t1"]'))

    vi.unstubAllGlobals()
  })

  it('gives up and resolves null once the poll frames are exhausted', () => {
    vi.stubGlobal('requestAnimationFrame', cb => {
      cb()
      return 0
    })
    const virtualizer = { scrollToIndex: vi.fn() }
    const onResolved = vi.fn()

    withMountedTurn({
      turnId: 'never-mounts',
      turns: [{ turn_id: 'never-mounts' }],
      virtualizer,
      onResolved,
    })

    expect(onResolved).toHaveBeenCalledWith(null)

    vi.unstubAllGlobals()
  })
})
