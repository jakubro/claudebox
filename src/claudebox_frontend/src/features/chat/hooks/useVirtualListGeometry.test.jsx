/** Tests for useScrollElementRef - the per-commit-write hazard it exists to avoid. */

import { render } from '@testing-library/react'
import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'
import { useScrollElementRef } from './useVirtualListGeometry'

/**
 * The mirror shape this hook replaces: a ref read into state from a dep-less layout effect,
 * reproduced here rather than imported so the regression stays testable.
 */
function useOldStyleMirror(ref, out) {
  const [el, setEl] = useState(null)
  useLayoutEffect(() => {
    out.effectRuns += 1
    const node = ref?.current ?? null
    setEl(prev => (prev === node ? prev : node))
  })

  return el
}

/** Forces `maxTicks` additional commits via a sibling dispatch, the same shape react-virtual's
 * own `rerender()` uses to mark the fiber's lanes non-zero on every pass. */
function useForcedCommits(maxTicks) {
  const [tick, forceTick] = useReducer(x => x + 1, 0)
  useLayoutEffect(() => {
    if (tick < maxTicks) {
      forceTick()
    }
  })
}

function OldPatternHarness({ maxTicks, out }) {
  const containerRef = useRef(null)
  useOldStyleMirror(containerRef, out)
  useForcedCommits(maxTicks)

  return <div ref={containerRef} />
}

function NewPatternHarness({ maxTicks, out }) {
  const containerRef = useRef(null)
  const [, attachRef] = useScrollElementRef(containerRef)
  const countedAttach = useCallback(
    node => {
      out.attachRuns += 1
      attachRef(node)
    },
    [attachRef, out],
  )
  useForcedCommits(maxTicks)

  return <div ref={countedAttach} />
}

describe('useScrollElementRef', () => {
  it('holds the element once the callback ref attaches it', () => {
    function Harness() {
      const containerRef = useRef(null)
      const [scrollEl, attachRef] = useScrollElementRef(containerRef)
      return <div ref={attachRef} data-scroll-el={scrollEl ? 'present' : 'absent'} />
    }

    const { container } = render(<Harness />)
    expect(container.querySelector('div').dataset.scrollEl).toBe('present')
  })

  it('writes externalRef.current so every other reader of the ref keeps working', () => {
    const externalRef = { current: null }
    function Harness() {
      const [, attachRef] = useScrollElementRef(externalRef)
      return <div ref={attachRef} />
    }

    const { container } = render(<Harness />)
    expect(externalRef.current).toBe(container.querySelector('div'))
  })

  // The hazard this hook exists to prevent: a dep-less layout effect re-runs on every commit, so
  // it never stops participating in the update cycle and climbs React's nested-update counter.
  it('the pre-fix mirror shape re-runs on every commit, never settling', () => {
    const out = { effectRuns: 0 }
    render(<OldPatternHarness maxTicks={20} out={out} />)

    expect(out.effectRuns).toBe(21)
  })

  // attachRef is a callback ref, invoked by React only on a real mount/unmount/node-swap - not on
  // an unrelated re-render. Twenty sibling-forced commits produce a single attach.
  it('only attaches once despite twenty unrelated re-renders', () => {
    const out = { attachRuns: 0 }
    render(<NewPatternHarness maxTicks={20} out={out} />)

    expect(out.attachRuns).toBe(1)
  })
})
