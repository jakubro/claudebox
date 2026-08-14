/** Tests for useTextEditingKeys - the key dispatcher shared by the composer and reply boxes. */

import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BlockCollapseManager from '../BlockCollapseManager'
import useTextEditingKeys from './useTextEditingKeys'

// BlockCollapseManager's id counter is global - reset it so expected ids stay independent of test order.
beforeEach(() => {
  BlockCollapseManager.resetGlobalCounterForTests()
})

function keyEvent(key, { shiftKey = false, altKey = false, ctrlKey = false } = {}) {
  return { key, shiftKey, altKey, ctrlKey, metaKey: false, preventDefault: vi.fn() }
}

function setup(overrides = {}) {
  const applyResult = vi.fn()
  const getState = vi.fn(() => ({ value: 'hello', selStart: 5, selEnd: 5 }))
  const { result } = renderHook(() =>
    useTextEditingKeys({
      getState,
      applyResult,
      collapseManager: new BlockCollapseManager(),
      ...overrides,
    }),
  )
  return { handleKeyDown: result.current.handleKeyDown, applyResult, getState }
}

describe('useTextEditingKeys - handled/unhandled contract', () => {
  it('returns true and applies a result for Tab', () => {
    const { handleKeyDown, applyResult } = setup()
    const e = keyEvent('Tab')

    expect(handleKeyDown(e)).toBe(true)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(applyResult).toHaveBeenCalledWith({ value: 'hello  ', selStart: 7, selEnd: 7 })
  })

  it('returns true but does not apply a result for a no-op Shift+Tab', () => {
    const { handleKeyDown, applyResult } = setup({
      getState: vi.fn(() => ({ value: 'hello', selStart: 0, selEnd: 0 })),
    })
    const e = keyEvent('Tab', { shiftKey: true })

    expect(handleKeyDown(e)).toBe(true)
    expect(applyResult).not.toHaveBeenCalled()
  })

  it('returns false for an ordinary character with no modifiers', () => {
    const { handleKeyDown, applyResult } = setup()

    expect(handleKeyDown(keyEvent('a'))).toBe(false)
    expect(applyResult).not.toHaveBeenCalled()
  })
})

describe('useTextEditingKeys - collapse/expand delegation', () => {
  it("collapseLocal on Ctrl+' applies the manager result with a pinned cursor", () => {
    const applyResult = vi.fn()
    const manager = new BlockCollapseManager()
    const getState = vi.fn(() => ({ value: '<div>hello</div>', selStart: 7, selEnd: 7 }))
    const { result } = renderHook(() =>
      useTextEditingKeys({ getState, applyResult, collapseManager: manager }),
    )

    result.current.handleKeyDown(keyEvent("'", { ctrlKey: true }))

    expect(applyResult).toHaveBeenCalledWith({ value: '<div...1>', selStart: 9, selEnd: 9 })
  })

  it('collapseAll on Ctrl+" applies the value with no explicit selection', () => {
    const applyResult = vi.fn()
    const manager = new BlockCollapseManager()
    const getState = vi.fn(() => ({ value: '<div>hello</div>', selStart: 0, selEnd: 0 }))
    const { result } = renderHook(() =>
      useTextEditingKeys({ getState, applyResult, collapseManager: manager }),
    )

    result.current.handleKeyDown(keyEvent('"', { ctrlKey: true }))

    expect(applyResult).toHaveBeenCalledWith({ value: '<div...1>' })
  })

  it('collapseLocal is a no-op when the cursor is outside any block', () => {
    const { handleKeyDown, applyResult } = setup()

    handleKeyDown(keyEvent("'", { ctrlKey: true }))

    expect(applyResult).not.toHaveBeenCalled()
  })
})

describe('useTextEditingKeys - interrupt', () => {
  it('calls onInterrupt on Ctrl+.', () => {
    const onInterrupt = vi.fn()
    const { handleKeyDown } = setup({ onInterrupt })

    handleKeyDown(keyEvent('.', { ctrlKey: true }))

    expect(onInterrupt).toHaveBeenCalledTimes(1)
  })

  it('does not call onInterrupt when canInterrupt is false', () => {
    const onInterrupt = vi.fn()
    const { handleKeyDown } = setup({ onInterrupt, canInterrupt: false })

    handleKeyDown(keyEvent('.', { ctrlKey: true }))

    expect(onInterrupt).not.toHaveBeenCalled()
  })
})

describe('useTextEditingKeys - wrap in tags', () => {
  it('applies the wrap-in-tags result on Ctrl+,', () => {
    const { handleKeyDown, applyResult } = setup()

    handleKeyDown(keyEvent(',', { ctrlKey: true }))

    expect(applyResult).toHaveBeenCalledWith({
      value: 'hello<this></this>',
      selStart: 11,
      selEnd: 11,
    })
  })
})
