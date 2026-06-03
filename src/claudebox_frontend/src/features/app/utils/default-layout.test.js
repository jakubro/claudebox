/** Tests for buildDefaultLayout utility. */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../config/dimensions', () => ({
  DEFAULT_PANEL_WIDTH: 0.25,
}))

import { applyMainGroupMarker, buildDefaultLayout } from './default-layout'

describe('buildDefaultLayout', () => {
  let api
  let manager

  beforeEach(() => {
    // Return a panel with a fresh group.element each call so the synchronous
    // setAttribute on the main panel's group has a real DOM target.
    api = {
      addPanel: vi.fn(() => ({ group: { element: document.createElement('div') } })),
    }
    manager = {
      state: {
        left: { order: [] },
        right: { order: [] },
      },
    }
    vi.stubGlobal('innerWidth', 1000)
  })

  it('adds main panel first', () => {
    buildDefaultLayout(api, manager)
    expect(api.addPanel.mock.calls[0][0]).toMatchObject({
      id: 'main',
      component: 'main',
      title: 'Main',
    })
  })

  it('adds 1 left panel (sessions with direction:left, no stacked siblings)', () => {
    buildDefaultLayout(api, manager)
    const sessionsCall = api.addPanel.mock.calls.find(c => c[0].id === 'sessions')
    expect(sessionsCall).toBeDefined()
    expect(sessionsCall[0].position).toMatchObject({
      direction: 'left',
      referencePanel: 'main',
    })
    expect(sessionsCall[0].initialWidth).toBe(250)

    expect(
      api.addPanel.mock.calls.find(
        c => c[0].id === 'bookmarks' && c[0].position?.direction === 'left',
      ),
    ).toBeUndefined()
    expect(
      api.addPanel.mock.calls.find(
        c => c[0].id === 'boards' && c[0].position?.direction === 'left',
      ),
    ).toBeUndefined()
  })

  it('adds 5 right panels (todos first with direction:right, rest stacked below in canonical order)', () => {
    buildDefaultLayout(api, manager)
    const todosCall = api.addPanel.mock.calls.find(c => c[0].id === 'todos')
    expect(todosCall[0].position).toMatchObject({
      direction: 'right',
      referencePanel: 'main',
    })

    const belowPanels = ['stash', 'tasks', 'bookmarks', 'boards']
    const rightPanels = ['todos', 'stash', 'tasks', 'bookmarks', 'boards']
    belowPanels.forEach((id, i) => {
      const call = api.addPanel.mock.calls.find(c => c[0].id === id)
      expect(call[0].position).toMatchObject({
        direction: 'below',
        referencePanel: rightPanels[i],
      })
    })
  })

  it('does not open Usage or MCP by default', () => {
    buildDefaultLayout(api, manager)
    const opened = api.addPanel.mock.calls.map(c => c[0].id)
    expect(opened).not.toContain('usage')
    expect(opened).not.toContain('mcp')
  })

  it('pushes panel ids into manager state arrays', () => {
    buildDefaultLayout(api, manager)
    expect(manager.state.left.order).toEqual(['sessions'])
    expect(manager.state.right.order).toEqual(['todos', 'stash', 'tasks', 'bookmarks', 'boards'])
  })

  it('marks the main panel group with data-main-group="true" synchronously', () => {
    const mainGroupElement = document.createElement('div')
    api.addPanel = vi.fn(opts => {
      if (opts.id === 'main') {
        return { group: { element: mainGroupElement } }
      }
      return { group: { element: document.createElement('div') } }
    })

    buildDefaultLayout(api, manager)

    expect(mainGroupElement.getAttribute('data-main-group')).toBe('true')
  })
})

describe('applyMainGroupMarker', () => {
  function group(panelIds) {
    return {
      panels: panelIds.map(id => ({ id })),
      element: document.createElement('div'),
    }
  }

  it('sets data-main-group="true" on a group hosting only the main panel', () => {
    const mainGroup = group(['main'])
    applyMainGroupMarker({ groups: [mainGroup] })
    expect(mainGroup.element.getAttribute('data-main-group')).toBe('true')
  })

  it('removes data-main-group from groups that no longer host only the main panel', () => {
    const mixedGroup = group(['main', 'sessions'])
    mixedGroup.element.setAttribute('data-main-group', 'true')
    applyMainGroupMarker({ groups: [mixedGroup] })
    expect(mixedGroup.element.hasAttribute('data-main-group')).toBe(false)
  })

  it('does not mark groups with other single-panel content', () => {
    const sessionsGroup = group(['sessions'])
    applyMainGroupMarker({ groups: [sessionsGroup] })
    expect(sessionsGroup.element.hasAttribute('data-main-group')).toBe(false)
  })

  it('marks only the main-only group across a mixed set', () => {
    const main = group(['main'])
    const sessions = group(['sessions'])
    const stacked = group(['todos', 'stash'])

    applyMainGroupMarker({ groups: [main, sessions, stacked] })

    expect(main.element.getAttribute('data-main-group')).toBe('true')
    expect(sessions.element.hasAttribute('data-main-group')).toBe(false)
    expect(stacked.element.hasAttribute('data-main-group')).toBe(false)
  })
})
