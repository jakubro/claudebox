/** Tests for layout persistence utilities. */

import { describe, expect, it, vi } from 'vitest'
import { buildSaveOps, stripSessionPanels } from './layoutPersistence'

describe('stripSessionPanels', () => {
  it('returns layout unchanged when no session panels', () => {
    const layout = {
      panels: { chat: { id: 'chat', title: 'Chat' } },
      grid: {
        root: { type: 'leaf', data: { id: 'g1', views: ['chat'], activeView: 'chat' } },
      },
    }

    const result = stripSessionPanels(layout)

    expect(result.panels).toEqual({ chat: { id: 'chat', title: 'Chat' } })
    expect(result.grid.root.data.views).toEqual(['chat'])
  })

  it('removes session panels from panels object', () => {
    const layout = {
      panels: {
        chat: { id: 'chat' },
        'session:abc': { id: 'session:abc' },
        'session:def': { id: 'session:def' },
        sessions: { id: 'sessions' },
      },
      grid: {
        root: { type: 'leaf', data: { id: 'g1', views: ['chat'], activeView: 'chat' } },
      },
    }

    const result = stripSessionPanels(layout)

    expect(Object.keys(result.panels)).toEqual(['chat', 'sessions'])
  })

  it('removes session views from leaf node', () => {
    const layout = {
      panels: { chat: { id: 'chat' }, 'session:abc': { id: 'session:abc' } },
      grid: {
        root: {
          type: 'leaf',
          data: { id: 'g1', views: ['chat', 'session:abc', 'session:def'], activeView: 'chat' },
        },
      },
    }

    const result = stripSessionPanels(layout)

    expect(result.grid.root.data.views).toEqual(['chat'])
  })

  it('fixes activeView when it points to a session panel', () => {
    const layout = {
      panels: { chat: { id: 'chat' }, 'session:abc': { id: 'session:abc' } },
      grid: {
        root: {
          type: 'leaf',
          data: { id: 'g1', views: ['chat', 'session:abc'], activeView: 'session:abc' },
        },
      },
    }

    const result = stripSessionPanels(layout)

    expect(result.grid.root.data.activeView).toBe('chat')
  })

  it('preserves activeView when it is not a session panel', () => {
    const layout = {
      panels: { chat: { id: 'chat' }, 'session:abc': { id: 'session:abc' } },
      grid: {
        root: {
          type: 'leaf',
          data: { id: 'g1', views: ['chat', 'session:abc'], activeView: 'chat' },
        },
      },
    }

    const result = stripSessionPanels(layout)

    expect(result.grid.root.data.activeView).toBe('chat')
  })

  it('handles nested branch structure', () => {
    const layout = {
      panels: {
        chat: { id: 'chat' },
        sessions: { id: 'sessions' },
        'session:abc': { id: 'session:abc' },
      },
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: { id: 'g1', views: ['chat', 'session:abc'], activeView: 'chat' },
            },
            {
              type: 'branch',
              data: [
                {
                  type: 'leaf',
                  data: { id: 'g2', views: ['sessions'], activeView: 'sessions' },
                },
              ],
            },
          ],
        },
      },
    }

    const result = stripSessionPanels(layout)

    expect(result.grid.root.data[0].data.views).toEqual(['chat'])
    expect(result.grid.root.data[1].data[0].data.views).toEqual(['sessions'])
    expect(result.panels).toEqual({ chat: { id: 'chat' }, sessions: { id: 'sessions' } })
  })

  it('returns layout unchanged for null/undefined input', () => {
    expect(stripSessionPanels(null)).toBeNull()
    expect(stripSessionPanels(undefined)).toBeUndefined()
  })

  it('returns layout unchanged when missing panels', () => {
    const layout = { grid: { root: { type: 'leaf', data: { views: [] } } } }
    expect(stripSessionPanels(layout)).toBe(layout)
  })

  it('returns layout unchanged when missing grid root', () => {
    const layout = { panels: { chat: {} }, grid: {} }
    expect(stripSessionPanels(layout)).toBe(layout)
  })

  it('does not mutate the original layout', () => {
    const layout = {
      panels: { chat: { id: 'chat' }, 'session:abc': { id: 'session:abc' } },
      grid: {
        root: {
          type: 'leaf',
          data: { id: 'g1', views: ['chat', 'session:abc'], activeView: 'session:abc' },
        },
      },
    }

    stripSessionPanels(layout)

    expect(layout.panels['session:abc']).toBeDefined()
    expect(layout.grid.root.data.views).toContain('session:abc')
  })

  it('handles empty views after stripping all session panels', () => {
    const layout = {
      panels: { 'session:abc': { id: 'session:abc' } },
      grid: {
        root: {
          type: 'leaf',
          data: { id: 'g1', views: ['session:abc'], activeView: 'session:abc' },
        },
      },
    }

    const result = stripSessionPanels(layout)

    expect(result.grid.root.data.views).toEqual([])
    expect(result.grid.root.data.activeView).toBeUndefined()
  })
})

describe('buildSaveOps', () => {
  it('strips session panels from api.toJSON() output', () => {
    const mockApi = {
      toJSON: vi.fn(() => ({
        panels: { chat: { id: 'chat' }, 'session:abc': { id: 'session:abc' } },
        grid: {
          root: {
            type: 'leaf',
            data: { id: 'g1', views: ['chat', 'session:abc'], activeView: 'chat' },
          },
        },
      })),
    }
    const mockManager = { toJSON: vi.fn(() => ({ left: { order: [] } })) }

    const ops = buildSaveOps(mockApi, mockManager, null)

    const layoutOp = ops.find(op => op.path === 'layout')
    expect(Object.keys(layoutOp.value.panels)).toEqual(['chat'])
    expect(layoutOp.value.grid.root.data.views).toEqual(['chat'])
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
