/** Integration through the real provider tree, network faked: leaving a session releases it. */

import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getContainerId, setAddress } from '../../api/apiClient'
import { useEvents } from '../../context/EventsContext'
import { useSessionActions, useSessionData } from '../../context/SessionDataContext'
import { useWorkspace } from '../../context/WorkspaceContext'
import AppProviders from './AppProviders'

const WORKSPACES = [
  { id: 'W1', path: '/work/one', name: 'one' },
  { id: 'W2', path: '/work/two', name: 'two' },
]

let requests
let sources

class FakeEventSource {
  constructor(url) {
    this.url = url
    this.readyState = 0
    this.closed = false
    sources.push(this)
    setTimeout(() => {
      if (!this.closed) {
        this.readyState = 1
        this.onopen?.(new Event('open'))
      }
    }, 0)
  }

  addEventListener() {}

  removeEventListener() {}

  close() {
    this.closed = true
    this.readyState = 2
  }
}

function json(body) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))
}

function fakeFetch(url, init = {}) {
  const method = init.method ?? 'GET'
  requests.push(`${method} ${url}`)

  if (url === '/api/workspaces') {
    return json({ workspaces: WORKSPACES })
  }
  if (url.endsWith('/sessions/sess-a/resume')) {
    return json({ session_id: 'sess-a', container_id: 'cA' })
  }
  if (url.endsWith('/containers/cA/api/sessions/current?session_id=sess-a')) {
    return json({ session_id: 'sess-a', name: 'Session A', workspace: '/work/one' })
  }
  return json({})
}

let probe

function Probe() {
  probe = {
    events: useEvents(),
    data: useSessionData(),
    actions: useSessionActions(),
    workspace: useWorkspace(),
  }
  return null
}

const REFS = {
  jumpRefs: { prev: {}, next: {}, top: {}, bottom: {} },
  rightColumnJumpRefs: { prev: {}, next: {} },
  newSessionRefs: { newSession: {}, newSessionInNewTab: {} },
  scrollIntentRefs: { userIntent: {}, programmaticScroll: {} },
  panelCallbacks: {
    onFocusChat: () => {},
    panelSwitchingRef: { current: false },
    onMaximizeToggle: () => {},
    isMaximized: false,
    onClosePanel: () => {},
    onSessionAttach: () => {},
  },
}

async function setHash(hash) {
  await act(async () => {
    window.location.hash = hash
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

async function openSessionA() {
  window.location.hash = '#/workspaces/W1/sessions/sess-a'
  render(
    <AppProviders {...REFS}>
      <Probe />
    </AppProviders>,
  )
  await waitFor(() => {
    expect(probe.data.sessionId).toBe('sess-a')
  })
}

const openStreams = () => sources.filter(s => !s.closed).map(s => s.url)

describe('leaving a session', () => {
  beforeEach(() => {
    requests = []
    sources = []
    setAddress(null)
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('opening A attaches its container and streams - a guard', async () => {
    await openSessionA()

    expect(getContainerId()).toBe('cA')
    expect(openStreams()).toContain('/api/workspaces/W1/containers/cA/api/stream?session_id=sess-a')
  })

  it('the bare workspace address releases the container id and every stream', async () => {
    await openSessionA()

    await setHash('#/workspaces/W1')

    await waitFor(() => {
      expect(getContainerId()).toBe(null)
    })
    expect(probe.events.containerId).toBe(null)
    expect(probe.data.sessionId).toBe(null)
    expect(openStreams().filter(url => url.includes('/containers/'))).toEqual([])
  })

  it('a pick on the bare workspace address sends nothing to the session left', async () => {
    await openSessionA()
    await setHash('#/workspaces/W1')
    await waitFor(() => {
      expect(getContainerId()).toBe(null)
    })
    requests = []

    act(() => {
      probe.actions.setModel('claude-sonnet-5')
    })

    expect(requests.filter(r => r.includes('/api/model'))).toEqual([])
  })

  it('a board route releases the session', async () => {
    await openSessionA()

    await setHash('#/workspaces/W1/boards/b1')

    await waitFor(() => {
      expect(getContainerId()).toBe(null)
    })
  })

  it("a workspace switch neither reopens the old workspace's stream nor addresses its container", async () => {
    await openSessionA()
    requests = []
    const before = sources.length

    // The workspace switcher's own sequence: select, then navigate to the new workspace's home.
    act(() => {
      probe.workspace.selectWorkspace('W2')
    })
    await setHash('#/workspaces/W2')

    await waitFor(() => {
      expect(getContainerId()).toBe(null)
    })
    act(() => {
      probe.actions.setModel('claude-sonnet-5')
    })
    const reopened = sources.slice(before).filter(s => s.url.includes('/containers/cA/'))
    expect(reopened).toEqual([])
    expect(requests.filter(r => r.includes('/containers/cA/'))).toEqual([])
  })

  it('returning to A resumes and streams again - a guard', async () => {
    await openSessionA()
    await setHash('#/workspaces/W1')
    await waitFor(() => {
      expect(getContainerId()).toBe(null)
    })

    await setHash('#/workspaces/W1/sessions/sess-a')

    await waitFor(() => {
      expect(getContainerId()).toBe('cA')
    })
    await waitFor(() => {
      expect(openStreams()).toContain(
        '/api/workspaces/W1/containers/cA/api/stream?session_id=sess-a',
      )
    })
  })
})

describe('following a link into another workspace', () => {
  beforeEach(() => {
    requests = []
    sources = []
    setAddress(null)
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn(fakeFetch))
    vi.stubGlobal('EventSource', FakeEventSource)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.location.hash = ''
  })

  it('opens the session the link names', async () => {
    window.location.hash = '#/workspaces/W2'
    render(
      <AppProviders {...REFS}>
        <Probe />
      </AppProviders>,
    )
    await waitFor(() => {
      expect(probe.workspace.workspaceId).toBe('W2')
    })

    await setHash('#/workspaces/W1/sessions/sess-a')

    await waitFor(() => {
      expect(probe.data.sessionId).toBe('sess-a')
    })
    expect(probe.workspace.workspaceId).toBe('W1')
    expect(window.location.hash).toBe('#/workspaces/W1/sessions/sess-a')
  })
})
