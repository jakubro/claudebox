/** E2E tests for notification behavior. */

import { expect, test } from '@playwright/test'
import { resolveOpsPayload, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { createSSEController, mockSSE } from '../mocks/sse.js'

test.describe('Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
  })

  test.describe('Tab Title', () => {
    // SPEC: notify:title-format
    test('tab title matches both documented formats (named + pre-init)', async ({ page }) => {
      // Default fixture has no session name -> 2-segment form: `[Workspace] | Claudebox`.
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)
      const preInit = await page.title()
      const preSegs = preInit.split('|').map(s => s.trim())
      expect(preSegs.length, `pre-init title was "${preInit}"`).toBe(2)
      expect(preSegs[0]).not.toBe('')
      expect(preSegs[1]).toBe('Claudebox')

      // Provide a named session via /api/sessions/current and reload - the
      // 3-segment form `[Session Name] | [Workspace] | Claudebox` must appear.
      await page.route('**/api/sessions/current**', async route => {
        if (route.request().method() === 'GET') {
          await route.fulfill({
            json: {
              session_id: 'test-session-001',
              name: 'My Named Session',
              workspace: '/home/user/project',
              num_turns: 0,
              total_cost_usd: 0,
              total_duration_ms: 0,
              last_context_tokens: 0,
              started_at: '2025-01-18T12:00:00Z',
              updated_at: '2025-01-18T12:00:00Z',
              container_id: 'test-cid',
            },
          })
        } else {
          await route.fallback()
        }
      })
      await page.reload()
      await waitForAppReady(page)
      // Title updates asynchronously after the session payload arrives - poll.
      await expect.poll(async () => (await page.title()).split('|').length).toBe(3)
      const namedTitle = await page.title()
      const segs = namedTitle.split('|').map(s => s.trim())
      expect(segs[0]).toBe('My Named Session')
      expect(segs[1]).not.toBe('')
      expect(segs[2]).toBe('Claudebox')
    })

    // SPEC: notify:tab-indicator-clear
    test('tab title indicator clears on click, on typing, and on window focus', async ({
      page,
    }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect(page.getByText('Hello! How can I help you today?')).toBeVisible()

      // Helper: force a leading "* " and confirm the page sees it.
      const setStarPrefix = () =>
        page.evaluate(() => {
          if (!document.title.startsWith('* ')) {
            document.title = `* ${document.title}`
          }
        })

      // Path 1: click clears the indicator
      await setStarPrefix()
      expect((await page.title()).startsWith('* ')).toBe(true)
      await page.locator('[data-testid="chat-input"]').click()
      await expect.poll(async () => (await page.title()).startsWith('* ')).toBe(false)

      // Path 2: typing clears the indicator
      await setStarPrefix()
      expect((await page.title()).startsWith('* ')).toBe(true)
      await page.keyboard.type('a')
      await expect.poll(async () => (await page.title()).startsWith('* ')).toBe(false)
      // Reset textarea
      await page.locator('[data-testid="chat-input"]').fill('')

      // Path 3: window focus clears the indicator (after losing focus first)
      await setStarPrefix()
      expect((await page.title()).startsWith('* ')).toBe(true)
      // Dispatch synthetic focus events to mirror the window.onfocus path.
      await page.evaluate(() => {
        window.dispatchEvent(new Event('blur'))
        window.dispatchEvent(new Event('focus'))
      })
      await expect.poll(async () => (await page.title()).startsWith('* ')).toBe(false)
    })
  })

  test.describe('Notification Permission', () => {
    // SPEC: notify:desktop-permission
    test('no desktop notification fires when browser permission is denied', async ({ page }) => {
      // Mock Notification API with denied permission
      await page.addInitScript(() => {
        window.__notificationInstances = []
        class MockNotification {
          constructor(title, options = {}) {
            this.title = title
            this.body = options.body
            window.__notificationInstances.push(this)
          }
          close() {}
        }
        MockNotification.permission = 'denied'
        MockNotification.requestPermission = async () => 'denied'
        window.Notification = MockNotification
      })

      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications toggle
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Send a complete turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_perm',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Permission denied response',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_perm',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])

      await expect(page.getByText('Permission denied response').first()).toBeVisible()

      // No notification should have been created with denied permission
      // Poll briefly to confirm no notifications fire asynchronously
      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length), { timeout: 1000 })
        .toBe(0)
    })
  })

  test.describe('Notifications Toggle', () => {
    // SPEC: footer:notifications
    test('toggle button visible in footer', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await expect(toggle).toBeVisible()
    })

    // SPEC: footer:notifications-default
    test('notifications disabled by default', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await expect(toggle).toBeVisible()
      // Default is disabled - no 'enabled' class
      await expect(toggle).not.toHaveClass(/enabled/)
    })

    // SPEC: footer:notifications-on
    // SPEC: footer:notifications-off
    test('toggle renders Bell icon, with strike-through ONLY when disabled', async ({ page }) => {
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')

      // Bell icon present in both states (claim names "Bell icon" for both).
      const bell = toggle.locator('svg[aria-label*="Notifications"]')
      await expect(bell).toBeVisible()

      // Default (disabled): strike-through must be present, with the documented
      // top-left-to-bottom-right diagonal direction.
      const strike = toggle.locator('.strikethrough')
      await expect(strike).toBeVisible()
      const transform = await strike.evaluate(el => getComputedStyle(el).transform)
      // matrix(a, b, c, d, ...) for rotate(-45deg) has b < 0 - corresponds to a
      // line that descends from top-left to bottom-right.
      const m = transform.match(/matrix\(([-\d.]+),\s*([-\d.]+),/)
      expect(m).toBeTruthy()
      expect(Number(m[2])).toBeLessThan(0)

      // Click to enable - strike-through must disappear.
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)
      await expect(toggle.locator('.strikethrough')).toHaveCount(0)
      // Bell remains visible in enabled state.
      await expect(bell).toBeVisible()

      // Click again to disable - strike-through returns.
      await toggle.click()
      await expect(toggle).not.toHaveClass(/enabled/)
      await expect(toggle.locator('.strikethrough')).toBeVisible()
    })

    // SPEC: footer:notifications-scope
    test('single toggle controls both sound chime and desktop notifications', async ({ page }) => {
      // Install audio mock BEFORE page.goto
      await page.addInitScript(() => {
        const _calls = { oscillatorStart: 0 }
        window.__audioScopeCalls = _calls
        class MockGainNode {
          constructor() {
            this.gain = {
              value: 1,
              setValueAtTime: () => {},
              exponentialRampToValueAtTime: () => {},
            }
          }
          connect() {}
        }
        class MockOscillatorNode {
          constructor() {
            this.frequency = { value: 440 }
          }
          set type(_) {}
          get type() {
            return 'sine'
          }
          connect() {}
          start() {
            _calls.oscillatorStart++
          }
          stop() {}
        }
        class MockAudioContext {
          constructor() {
            this.currentTime = 0
            this.destination = {}
          }
          createOscillator() {
            return new MockOscillatorNode()
          }
          createGain() {
            return new MockGainNode()
          }
        }
        window.AudioContext = MockAudioContext
        window.webkitAudioContext = MockAudioContext
      })
      // Install notification mock
      await page.addInitScript(() => {
        window.__notifScopeInstances = []
        class MockNotification {
          constructor(title, options = {}) {
            this.title = title
            this.body = options.body
            window.__notifScopeInstances.push(this)
          }
          close() {}
        }
        MockNotification.permission = 'granted'
        MockNotification.requestPermission = async () => 'granted'
        window.Notification = MockNotification
      })

      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable the single notifications toggle
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Send a complete turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Scope test',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_scope',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Scope response',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_scope',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])
      await expect(page.getByText('Scope response').first()).toBeVisible()

      // Both sound (oscillator) AND desktop notification should have fired
      await expect
        .poll(() => page.evaluate(() => window.__audioScopeCalls.oscillatorStart))
        .toBeGreaterThan(0)
      await expect
        .poll(() => page.evaluate(() => window.__notifScopeInstances.length))
        .toBeGreaterThan(0)
    })

    // SPEC: footer:notifications-storage
    test('notifications toggle is per-session AND restored on refresh', async ({ page }) => {
      // Use the default mockAPI ui-state mock (in-memory persistence across
      // GET/PATCH within the test). Capture PATCH bodies via a non-intrusive
      // request listener so the mock's storage still applies the writes.
      await mockAPI(page)
      await mockSSE(page)

      const patchCalls = []
      page.on('request', request => {
        if (request.url().includes('/ui-state') && request.method() === 'PATCH') {
          try {
            patchCalls.push(JSON.parse(request.postData() || '{}'))
          } catch {
            // ignore malformed bodies
          }
        }
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Multiple PATCH calls may fire in rapid succession (layout, panelGroups,
      // notifications toggle, etc.). Find the one that carries the notification
      // key - it must arrive under SESSION scope, not GLOBAL.
      let notifPatch = null
      await expect
        .poll(() => {
          notifPatch = patchCalls.find(p => {
            const r = resolveOpsPayload(p)
            return Object.keys(r.session || {}).some(k => /notification/i.test(k))
          })
          return notifPatch !== undefined
        })
        .toBe(true)

      const resolved = resolveOpsPayload(notifPatch)
      const sessionKeys = Object.keys(resolved.session || {})
      const globalKeys = Object.keys(resolved.global || {})
      expect(sessionKeys.some(k => /notification/i.test(k))).toBe(true)
      expect(globalKeys.some(k => /notification/i.test(k))).toBe(false)

      // Refresh survives: the in-memory ui-state mock keeps the PATCHed value,
      // so reloading the page must rehydrate the toggle into its enabled state.
      await page.reload()
      await waitForAppReady(page)
      await expect(page.locator('[data-testid="footer-notifications-toggle"]')).toHaveClass(
        /enabled/,
      )
    })
  })

  test.describe('Tab Title Indicator', () => {
    // SPEC: notify:tab-indicator
    // SPEC: notify:tab-indicator-prefix
    test('tab title gets * prefix when response completes while hidden', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Simulate tab being hidden
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Enable notifications first
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Send a complete turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_notify',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Response while hidden',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_notify',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])

      // Wait for response to render
      await expect(page.getByText('Response while hidden').first()).toBeVisible()

      // Title should have * prefix
      await expect.poll(() => page.title()).toMatch(/^\* /)
    })

    // SPEC: notify:tab-indicator-clear
    test('tab title * prefix clears on user interaction', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab being hidden
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Send a complete turn to trigger the * prefix
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_clear',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Response for clearing',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_clear',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])
      await expect(page.getByText('Response for clearing').first()).toBeVisible()

      // Wait for * prefix to appear
      await expect.poll(() => page.title()).toMatch(/^\* /)

      // Simulate tab regaining focus (user interaction)
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Click input to trigger user interaction
      await page.locator('[data-testid="chat-input"]').click()

      // Title should no longer start with *
      await expect.poll(() => page.title()).not.toMatch(/^\* /)
    })
  })

  test.describe('Sound Alerts', () => {
    // Helper: install Web Audio API mock and return a handle to query recorded calls.
    // Must be called BEFORE page.goto so the mock is in place when app code runs.
    async function installAudioMock(page) {
      await page.addInitScript(() => {
        const _calls = {
          audioContextCreated: 0,
          oscillatorStart: 0,
          oscillatorType: null,
          gainValues: [],
        }
        window.__audioMockCalls = _calls

        class MockGainNode {
          constructor() {
            this.gain = {
              value: 1,
              setValueAtTime: (value, _time) => {
                _calls.gainValues.push(value)
              },
              exponentialRampToValueAtTime: (_value, _time) => {},
            }
          }
          connect() {}
        }

        class MockOscillatorNode {
          constructor() {
            this.frequency = { value: 440 }
          }
          set type(val) {
            _calls.oscillatorType = val
          }
          get type() {
            return _calls.oscillatorType
          }
          connect() {}
          start() {
            _calls.oscillatorStart++
          }
          stop() {}
        }

        class MockAudioContext {
          constructor() {
            _calls.audioContextCreated++
            this.currentTime = 0
            this.destination = {}
          }
          createOscillator() {
            return new MockOscillatorNode()
          }
          createGain() {
            return new MockGainNode()
          }
        }

        window.AudioContext = MockAudioContext
        window.webkitAudioContext = MockAudioContext
      })
    }

    // Helper: simulate hidden tab
    async function simulateTabHidden(page) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    // Helper: send a complete turn via SSE controller
    async function sendCompleteTurn(controller, { resultSubtype = 'success' } = {}) {
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Test sound',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_sound',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Done with sound test',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: resultSubtype,
          turn_id: 'turn_sound',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])
    }

    // SPEC: notify:sound
    // SPEC: notify:sound-trigger
    test('plays sound when notifications enabled and tab is hidden on response complete', async ({
      page,
    }) => {
      await installAudioMock(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a complete turn
      await sendCompleteTurn(controller)

      // Wait for response to render
      await expect(page.getByText('Done with sound test').first()).toBeVisible()

      // Verify oscillator.start() was called
      await expect
        .poll(() => page.evaluate(() => window.__audioMockCalls.oscillatorStart))
        .toBeGreaterThan(0)
    })

    // SPEC: notify:sound-trigger
    test('does not play sound when tab is focused', async ({ page }) => {
      await installAudioMock(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Tab stays focused (default) - do NOT simulate hidden

      // Send a complete turn
      await sendCompleteTurn(controller)

      // Wait for response to render
      await expect(page.getByText('Done with sound test').first()).toBeVisible()

      // Verify oscillator.start() was NOT called - tab was focused
      const startCalls = await page.evaluate(() => window.__audioMockCalls.oscillatorStart)
      expect(startCalls).toBe(0)
    })

    // SPEC: notify:sound-type
    test('uses same chime type for success and error completions', async ({ page }) => {
      await installAudioMock(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a success turn
      await sendCompleteTurn(controller, { resultSubtype: 'success' })
      await expect(page.getByText('Done with sound test').first()).toBeVisible()

      // Record the oscillator type used for success
      const successType = await page.evaluate(() => window.__audioMockCalls.oscillatorType)

      // Reset mock counters for second turn
      await page.evaluate(() => {
        window.__audioMockCalls.oscillatorStart = 0
        window.__audioMockCalls.oscillatorType = null
      })

      // Re-hide the tab (interaction from above may have "focused" it)
      await simulateTabHidden(page)

      // Send an error turn
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Test error sound',
          timestamp: Date.now() + 1000,
          ts: new Date().toISOString(),
          turn_id: 'turn_sound_err',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Error sound test',
          timestamp: Date.now() + 1100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: 'error',
          turn_id: 'turn_sound_err',
          timestamp: Date.now() + 1200,
          ts: new Date().toISOString(),
        },
      ])

      await expect(page.getByText('Error sound test').first()).toBeVisible()

      // Record the oscillator type used for error
      const errorType = await page.evaluate(() => window.__audioMockCalls.oscillatorType)

      // Both should use the same oscillator type (sine)
      expect(successType).toBe('sine')
      expect(errorType).toBe('sine')
    })

    // SPEC: notify:sound-volume
    test('sound volume is quiet (less than 1.0)', async ({ page }) => {
      await installAudioMock(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a complete turn
      await sendCompleteTurn(controller)
      await expect(page.getByText('Done with sound test').first()).toBeVisible()

      // Verify gain value was set below 1.0 (quiet volume)
      const gainValues = await page.evaluate(() => window.__audioMockCalls.gainValues)
      expect(gainValues.length).toBeGreaterThan(0)
      for (const v of gainValues) {
        expect(v).toBeLessThan(1.0)
      }
    })

    // SPEC: notify:sound-default
    test('sound is disabled by default on fresh session', async ({ page }) => {
      await installAudioMock(page)
      await mockAPI(page)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // The notifications toggle should be off by default
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await expect(toggle).toBeVisible()
      await expect(toggle).not.toHaveClass(/enabled/)

      // No AudioContext should have been created without user enabling sound
      const ctxCount = await page.evaluate(() => window.__audioMockCalls.audioContextCreated)
      expect(ctxCount).toBe(0)
    })
  })

  test.describe('Favicon', () => {
    // SPEC: notify:favicon
    test('favicon reflects session state - idle vs processing produce different icons', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Capture idle favicon (after app ready, no active turn)
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]')?.href))
        .toMatch(/^data:image\/png/)
      const idleHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)

      // Start a response (enters processing state - no result yet)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Think',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_fav',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Processing...',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
      ])
      await expect(page.getByText('Processing...').first()).toBeVisible()

      // Favicon should change to processing variant (different from idle)
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(idleHref)
    })
  })

  test.describe('Desktop Notification Content', () => {
    /**
     * Helper: mock the browser Notification API so we can capture constructor
     * calls and onclick handlers without actually triggering OS notifications.
     * Also grants permission so the code path under test fires.
     */
    async function mockNotificationAPI(page) {
      await page.addInitScript(() => {
        window.__notificationInstances = []

        class MockNotification {
          constructor(title, options = {}) {
            this.title = title
            this.body = options.body
            this.icon = options.icon
            this.tag = options.tag
            this.onclick = null
            window.__notificationInstances.push(this)
          }

          close() {}
        }

        MockNotification.permission = 'granted'
        MockNotification.requestPermission = async () => 'granted'

        window.Notification = MockNotification
      })
    }

    /**
     * Helper: simulate tab being hidden (unfocused).
     */
    async function simulateTabHidden(page) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    /**
     * Helper: simulate tab being visible (focused).
     */
    async function simulateTabVisible(page) {
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
    }

    /**
     * Helper: send a complete turn via the SSE controller (user + assistant + result).
     */
    async function sendCompleteTurn(controller, assistantText, turnId = 'turn_desktop') {
      const now = Date.now()
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Test prompt',
          timestamp: now,
          ts: new Date().toISOString(),
          turn_id: turnId,
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: assistantText,
          timestamp: now + 100,
          ts: new Date().toISOString(),
        },
        {
          type: 'result',
          subtype: 'success',
          turn_id: turnId,
          timestamp: now + 200,
          ts: new Date().toISOString(),
        },
      ])
    }

    // SPEC: notify:desktop
    test('browser notification fires when response completes while tab is unfocused', async ({
      page,
    }) => {
      await mockNotificationAPI(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a complete turn to trigger notification
      await sendCompleteTurn(controller, 'Here is the response.')

      // Wait for response to render
      await expect(page.getByText('Here is the response.').first()).toBeVisible()

      // Verify Notification constructor was called (60ms setTimeout in useNotifications.js)
      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)
    })

    // SPEC: notify:desktop-trigger
    test('no notification fires when tab is focused', async ({ page }) => {
      await mockNotificationAPI(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Keep tab visible (default state)
      await simulateTabVisible(page)

      // Send a complete turn
      await sendCompleteTurn(controller, 'Visible tab response.')

      // Wait for response to render
      await expect(page.getByText('Visible tab response.').first()).toBeVisible()

      // No notification should have been created
      const count = await page.evaluate(() => window.__notificationInstances.length)
      expect(count).toBe(0)
    })

    // SPEC: notify:desktop-body
    test('notification body shows first ~50 chars of assistant message', async ({ page }) => {
      await mockNotificationAPI(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a turn with a long assistant message (>50 chars)
      const longMessage =
        'This is a long assistant response that exceeds fifty characters in total length for testing.'
      await sendCompleteTurn(controller, longMessage)

      // Wait for response to render
      await expect(page.getByText(longMessage).first()).toBeVisible()

      // Wait for notification to be created (60ms setTimeout in useNotifications.js)
      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)

      // Verify notification body is truncated to ~50 chars + "..."
      const body = await page.evaluate(() => {
        const instance = window.__notificationInstances[0]
        return instance ? instance.body : null
      })
      expect(body).not.toBeNull()
      expect(body).toBe(`${longMessage.slice(0, 50)}...`)
    })

    // SPEC: notify:desktop-click
    test('clicking notification focuses the window', async ({ page }) => {
      await mockNotificationAPI(page)
      const controller = await createSSEController(page)
      await mockAPI(page)

      // Track window.focus calls
      await page.addInitScript(() => {
        window.__focusCalled = false
        const originalFocus = window.focus.bind(window)
        window.focus = () => {
          window.__focusCalled = true
          originalFocus()
        }
      })

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a complete turn
      await sendCompleteTurn(controller, 'Click me notification.')

      // Wait for response to render
      await expect(page.getByText('Click me notification.').first()).toBeVisible()

      // Wait for notification to be created (60ms setTimeout in useNotifications.js)
      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)

      // Invoke the onclick handler on the created notification
      const clicked = await page.evaluate(() => {
        const instance = window.__notificationInstances[0]
        if (instance?.onclick) {
          instance.onclick()
          return true
        }
        return false
      })
      expect(clicked).toBe(true)

      // Verify window.focus was called
      const focusCalled = await page.evaluate(() => window.__focusCalled)
      expect(focusCalled).toBe(true)
    })

    // SPEC: notify:desktop-no-resume
    test('no notification fires on session resume while unfocused', async ({ page }) => {
      await mockNotificationAPI(page)

      // Use mockSSE with simple-chat fixture to simulate a resumed session
      // (events delivered on initial load = session resume, not a new response)
      await mockAPI(page)
      await mockSSE(page, 'events/simple-chat.jsonl')

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden before any new response
      await simulateTabHidden(page)

      // Wait for the initial SSE events to have rendered (session resume)
      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()

      // No notification should have fired for the resumed session
      const count = await page.evaluate(() => window.__notificationInstances.length)
      expect(count).toBe(0)
    })

    // SPEC: notify:desktop-title
    test('notification title matches browser tab title', async ({ page }) => {
      await mockNotificationAPI(page)
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Capture the browser tab title
      const tabTitle = await page.title()

      // Enable notifications
      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Simulate tab hidden
      await simulateTabHidden(page)

      // Send a complete turn to trigger notification
      await sendCompleteTurn(controller, 'Title match test.', 'turn_title')
      await expect(page.getByText('Title match test.').first()).toBeVisible()

      // Wait for notification to be created
      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)

      // Notification title should match the browser tab title
      const notifTitle = await page.evaluate(() => window.__notificationInstances[0].title)
      expect(notifTitle).toBe(tabTitle)
    })
  })

  test.describe('Favicon Indicator', () => {
    // SPEC: notify:favicon-processing
    test('favicon updates to data URL during processing', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Capture the initial favicon href
      const _initialHref = await page.evaluate(
        () => document.querySelector('link[rel="icon"]').href,
      )

      // Send a user message and begin an assistant response (no result yet - still processing)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Think about this',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_processing',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Let me think...',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
      ])

      // Wait for the assistant text to render (confirms processing state)
      await expect(page.getByText('Let me think...').first()).toBeVisible()

      // During processing, the favicon should be a canvas-generated data URL
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)
    })

    // SPEC: notify:favicon-change
    test('favicon changes to notification variant when response completes while hidden', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Capture the normal favicon href after initial render
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      const normalHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)

      // Start a response (enters processing state)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_favicon',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working on it...',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
      ])

      // Wait for processing to begin
      await expect(page.getByText('Working on it...').first()).toBeVisible()

      // Simulate tab being hidden before completion
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Complete the response while hidden
      await controller.sendEvents([
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_favicon',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])

      // Favicon should change to notification variant (different from normal)
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(normalHref)

      // It should still be a canvas data URL
      const notificationHref = await page.evaluate(
        () => document.querySelector('link[rel="icon"]').href,
      )
      expect(notificationHref).toMatch(/^data:image\/png/)
    })

    // SPEC: notify:favicon-restore
    test('favicon restores to normal when tab regains focus after notification', async ({
      page,
    }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for normal favicon to be set
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      const normalHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)

      // Start a response (enters processing state)
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hello',
          timestamp: Date.now(),
          ts: new Date().toISOString(),
          turn_id: 'turn_restore',
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Here you go',
          timestamp: Date.now() + 100,
          ts: new Date().toISOString(),
        },
      ])

      await expect(page.getByText('Here you go').first()).toBeVisible()

      // Hide tab before completion
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Complete the response while hidden (triggers notification favicon)
      await controller.sendEvents([
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_restore',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])

      // Wait for notification favicon to be set
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(normalHref)

      // Simulate tab regaining focus
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // Favicon should restore to normal state
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toBe(normalHref)
    })
  })

  test.describe('Favicon Workspace Badge', () => {
    /**
     * Sample the average ARGB at a pixel region of the current favicon dataURL.
     * Runs entirely in-page so the canvas decoder uses real Chromium rendering.
     */
    const samplePixelInPage = async (page, { x, y, w, h }) =>
      await page.evaluate(
        async ({ x, y, w, h }) => {
          const href = document.querySelector('link[rel="icon"]').href
          const img = await new Promise((resolve, reject) => {
            const i = new Image()
            i.onload = () => resolve(i)
            i.onerror = reject
            i.src = href
          })
          const c = document.createElement('canvas')
          c.width = img.width
          c.height = img.height
          const ctx = c.getContext('2d')
          ctx.drawImage(img, 0, 0)
          const data = ctx.getImageData(x, y, w, h).data
          let r = 0
          let g = 0
          let b = 0
          let a = 0
          const n = data.length / 4
          for (let i = 0; i < data.length; i += 4) {
            r += data[i]
            g += data[i + 1]
            b += data[i + 2]
            a += data[i + 3]
          }
          return { r: r / n, g: g / n, b: b / n, a: a / n }
        },
        { x, y, w, h },
      )

    // Helper to mock ui-state with a workspaceColor.
    const mockApiWithColor = async (page, color) => {
      await mockAPI(page, {
        handlers: {
          getUIState: async route => {
            await route.fulfill({
              json: {
                global: color ? { workspaceColor: color } : {},
                session: {},
              },
            })
          },
        },
      })
    }

    // Sample coords: the 3×3 region at (22,22) sits inside the badge fill area
    // AND inside the C-arc's empty interior (radial distance from canvas
    // center <= 11.3, below the arc's inner edge at radius 12). When no badge
    // is drawn, the region is transparent; when a badge is drawn, it fills
    // with the workspace color.

    // SPEC: notify:favicon-workspace-badge
    // SPEC: notify:favicon-workspace-badge-color
    test('badge appears in bottom-right corner with workspace color when set', async ({ page }) => {
      // Deep red workspace color - distinguishable from arc gradient.
      const colorHex = '#c81818'
      await mockApiWithColor(page, colorHex)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Wait for favicon to render (canvas data URL set).
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      // The badge sits at x∈[18,30], y∈[18,30] on the 32×32 canvas.
      // Sample center pixels [22..27]×[22..27] - squarely inside the badge fill.
      const pixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })
      // Expected color: #c81818 -> r=200, g=24, b=24. Allow ±25 per channel for
      // PNG quantisation / outline anti-aliasing on the sample border.
      expect(pixel.r).toBeGreaterThan(150)
      expect(pixel.g).toBeLessThan(80)
      expect(pixel.b).toBeLessThan(80)
      expect(pixel.a).toBeGreaterThan(200)
    })

    // SPEC: notify:favicon-workspace-badge-absent
    test('no badge renders in bottom-right corner when no workspace color is set', async ({
      page,
    }) => {
      await mockApiWithColor(page, null)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      // Without a badge the bottom-right region of the favicon is transparent
      // (the C-arc occupies the center, leaving the corner empty). Sample the
      // same region as the badge-present test.
      const pixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })
      // Average alpha should be ~0 (transparent) when no badge fills the region.
      expect(pixel.a).toBeLessThan(50)
    })

    // SPEC: notify:favicon-workspace-badge-notification-dimmed
    test('badge renders at reduced opacity during notification state', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockApiWithColor(page, '#c81818')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Capture baseline badge pixel + href in normal (non-notification) state
      // BEFORE triggering processing - otherwise the post-trigger href IS the
      // notification variant and the poll-for-change never finds a delta.
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)
      const normalHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)
      const normalPixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })

      // Begin processing, then hide the tab, then complete - the
      // notification favicon paints once the result arrives while hidden.
      await controller.sendEvents([
        {
          type: 'user',
          subtype: 'text',
          is_human: true,
          content: 'Hi',
          turn_id: 'turn_dim',
          ts: new Date().toISOString(),
        },
        {
          type: 'assistant',
          subtype: 'text',
          content: 'Working...',
          ts: new Date().toISOString(),
        },
      ])
      await expect(page.getByText('Working...').first()).toBeVisible()
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await controller.sendEvents([
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_dim',
          ts: new Date().toISOString(),
        },
      ])

      // Wait for favicon to flip to notification variant.
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(normalHref)

      // Sample same badge region during notification. globalAlpha=0.5 halves
      // the badge's contribution to alpha.
      const notifPixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })

      // Normal badge alpha ~255; dimmed alpha ~127. Assert >=30% drop.
      expect(notifPixel.a).toBeLessThan(normalPixel.a * 0.7)
    })
  })
})
