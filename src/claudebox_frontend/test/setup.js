/** Global test setup for Vitest. */

import '@testing-library/jest-dom'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Browser API mocks (jsdom doesn't provide these)
global.IntersectionObserver = vi.fn(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}))

// CSS.escape (CSSOM spec) - jsdom exposes no global CSS object, and mountTurn.js/taskScroll.js
// call CSS.escape() before every querySelector on an id-derived attribute.
global.CSS = {
  escape(value) {
    return String(value).replace(/[^a-zA-Z0-9_-]/g, char => `\\${char}`)
  },
}

// Warning: this mock never fires callbacks. Tests needing resize events must override.
// A class (not vi.fn) so `new ResizeObserver()` works when a component instantiates it directly.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// Pointer capture (absent in jsdom 30): BottomPanelContainer and ChatSplitDivider drag with it.
// Tracks captured ids per element so hasPointerCapture() reflects real set/release pairs.
const capturedPointerIds = new WeakMap()
Element.prototype.setPointerCapture = function setPointerCapture(pointerId) {
  if (!capturedPointerIds.has(this)) {
    capturedPointerIds.set(this, new Set())
  }
  capturedPointerIds.get(this).add(pointerId)
}
Element.prototype.releasePointerCapture = function releasePointerCapture(pointerId) {
  capturedPointerIds.get(this)?.delete(pointerId)
}
Element.prototype.hasPointerCapture = function hasPointerCapture(pointerId) {
  return !!capturedPointerIds.get(this)?.has(pointerId)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
