/** Tests for layout persistence utilities. */

import { describe, expect, it, vi } from 'vitest'
import { buildSaveOps } from './layoutPersistence'

describe('buildSaveOps', () => {
  it('sets layout from api.toJSON() output', () => {
    const savedLayout = { panels: { chat: { id: 'chat' } }, grid: { root: {} } }
    const mockApi = { toJSON: vi.fn(() => savedLayout) }
    const mockManager = { toJSON: vi.fn(() => ({ left: { order: [] } })) }

    const ops = buildSaveOps(mockApi, mockManager, null)

    expect(ops.find(op => op.path === 'layout').value).toBe(savedLayout)
  })

  it('includes preMaximizeLayout when provided', () => {
    const mockApi = { toJSON: vi.fn(() => ({ panels: {}, grid: { root: {} } })) }
    const mockManager = { toJSON: vi.fn(() => ({})) }
    const preMax = { layout: {}, panelGroups: {} }

    const ops = buildSaveOps(mockApi, mockManager, preMax)

    expect(ops.find(op => op.path === 'preMaximizeLayout').value).toBe(preMax)
  })

  it('unsets preMaximizeLayout when null', () => {
    const mockApi = { toJSON: vi.fn(() => ({ panels: {}, grid: { root: {} } })) }
    const mockManager = { toJSON: vi.fn(() => ({})) }

    const ops = buildSaveOps(mockApi, mockManager, null)

    expect(ops.find(op => op.path === 'preMaximizeLayout')).toEqual({
      op: 'unset',
      path: 'preMaximizeLayout',
    })
  })
})
