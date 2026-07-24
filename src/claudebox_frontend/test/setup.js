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

// Warning: this mock never fires callbacks. Tests needing resize events must override.
// A class (not vi.fn) so `new ResizeObserver()` works when a component instantiates it directly.
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
