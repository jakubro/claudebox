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

      // Route /api/sessions/current to a named session and reload - expect the 3-segment title form.
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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

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

      // Short timeout catches a notification that fires asynchronously.
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

      // Strike-through must default to the documented top-left-to-bottom-right diagonal.
      const strike = toggle.locator('.strikethrough')
      await expect(strike).toBeVisible()
      const transform = await strike.evaluate(el => getComputedStyle(el).transform)
      // In matrix(a, b, c, d, ...), rotate(-45deg) gives b < 0: line descends top-left to bottom-right.
      const m = transform.match(/matrix\(([-\d.]+),\s*([-\d.]+),/)
      expect(m).toBeTruthy()
      expect(Number(m[2])).toBeLessThan(0)

      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)
      await expect(toggle.locator('.strikethrough')).toHaveCount(0)
      await expect(bell).toBeVisible()

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

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

      // Both the sound (oscillator) and the desktop notification must fire from one toggle.
      await expect
        .poll(() => page.evaluate(() => window.__audioScopeCalls.oscillatorStart))
        .toBeGreaterThan(0)
      await expect
        .poll(() => page.evaluate(() => window.__notifScopeInstances.length))
        .toBeGreaterThan(0)
    })

    // SPEC: footer:notifications-storage
    test('notifications toggle is per-session AND restored on refresh', async ({ page }) => {
      // A plain request listener, not route interception, avoids disturbing mockAPI's ui-state mock.
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

      // Multiple PATCH calls fire concurrently; the notification key must land under SESSION, not GLOBAL.
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

      // The in-memory ui-state mock keeps the PATCHed value, so reload must rehydrate the toggle as enabled.
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

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

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

      await expect(page.getByText('Response while hidden').first()).toBeVisible()

      await expect.poll(() => page.title()).toMatch(/^\* /)
    })

    // SPEC: notify:tab-indicator-clear
    test('tab title * prefix clears on user interaction', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockAPI(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

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

      await expect.poll(() => page.title()).toMatch(/^\* /)

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true })
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await page.locator('[data-testid="chat-input"]').click()

      await expect.poll(() => page.title()).not.toMatch(/^\* /)
    })
  })

  test.describe('Sound Alerts', () => {
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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await sendCompleteTurn(controller)

      await expect(page.getByText('Done with sound test').first()).toBeVisible()

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Deliberately does not call simulateTabHidden; the tab stays focused.

      await sendCompleteTurn(controller)

      await expect(page.getByText('Done with sound test').first()).toBeVisible()

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await sendCompleteTurn(controller, { resultSubtype: 'success' })
      await expect(page.getByText('Done with sound test').first()).toBeVisible()

      const successType = await page.evaluate(() => window.__audioMockCalls.oscillatorType)

      // Resets counters so the second measurement below isn't polluted by the first.
      await page.evaluate(() => {
        window.__audioMockCalls.oscillatorStart = 0
        window.__audioMockCalls.oscillatorType = null
      })

      // The click/interaction above may have refocused the tab.
      await simulateTabHidden(page)

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

      const errorType = await page.evaluate(() => window.__audioMockCalls.oscillatorType)

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await sendCompleteTurn(controller)
      await expect(page.getByText('Done with sound test').first()).toBeVisible()

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await expect(toggle).toBeVisible()
      await expect(toggle).not.toHaveClass(/enabled/)

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

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]')?.href))
        .toMatch(/^data:image\/png/)
      const idleHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)

      // No result event yet, so the turn stays in the processing state.
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

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(idleHref)
    })
  })

  test.describe('Desktop Notification Content', () => {
    // Captures constructor calls and onclick without triggering a real OS notification; permission is granted.
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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await sendCompleteTurn(controller, 'Here is the response.')

      await expect(page.getByText('Here is the response.').first()).toBeVisible()

      // useNotifications.js delays the Notification constructor call by 60ms.
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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      // Default state is already visible; this call makes that explicit for the test.
      await simulateTabVisible(page)

      await sendCompleteTurn(controller, 'Visible tab response.')

      await expect(page.getByText('Visible tab response.').first()).toBeVisible()

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      const longMessage =
        'This is a long assistant response that exceeds fifty characters in total length for testing.'
      await sendCompleteTurn(controller, longMessage)

      await expect(page.getByText(longMessage).first()).toBeVisible()

      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)

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

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await sendCompleteTurn(controller, 'Click me notification.')

      await expect(page.getByText('Click me notification.').first()).toBeVisible()

      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)

      const clicked = await page.evaluate(() => {
        const instance = window.__notificationInstances[0]
        if (instance?.onclick) {
          instance.onclick()
          return true
        }
        return false
      })
      expect(clicked).toBe(true)

      const focusCalled = await page.evaluate(() => window.__focusCalled)
      expect(focusCalled).toBe(true)
    })

    // SPEC: notify:desktop-no-resume
    test('no notification fires on session resume while unfocused', async ({ page }) => {
      await mockNotificationAPI(page)

      // Events delivered on initial load via this fixture are a session resume, not a new response.
      await mockAPI(page)
      await mockSSE(page, 'events/simple-chat.jsonl')

      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await expect(page.getByText('Hello! How can I help you today?').first()).toBeVisible()

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

      const tabTitle = await page.title()

      const toggle = page.locator('[data-testid="footer-notifications-toggle"]')
      await toggle.click()
      await expect(toggle).toHaveClass(/enabled/)

      await simulateTabHidden(page)

      await sendCompleteTurn(controller, 'Title match test.', 'turn_title')
      await expect(page.getByText('Title match test.').first()).toBeVisible()

      await expect
        .poll(() => page.evaluate(() => window.__notificationInstances.length))
        .toBeGreaterThan(0)

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

      const _initialHref = await page.evaluate(
        () => document.querySelector('link[rel="icon"]').href,
      )

      // No result event yet, so the turn stays in the processing state.
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

      await expect(page.getByText('Let me think...').first()).toBeVisible()

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

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      const normalHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)

      // No result event yet, so the turn stays in the processing state.
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

      await expect(page.getByText('Working on it...').first()).toBeVisible()

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // The result event alone (turn already in progress) completes the response while hidden.
      await controller.sendEvents([
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_favicon',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(normalHref)

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

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      const normalHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)

      // No result event yet, so the turn stays in the processing state.
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

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: true, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'hidden',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      // The result event alone completes the response while hidden, triggering the notification favicon.
      await controller.sendEvents([
        {
          type: 'result',
          subtype: 'success',
          turn_id: 'turn_restore',
          timestamp: Date.now() + 200,
          ts: new Date().toISOString(),
        },
      ])

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(normalHref)

      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { value: false, writable: true })
        Object.defineProperty(document, 'visibilityState', {
          value: 'visible',
          writable: true,
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toBe(normalHref)
    })
  })

  test.describe('Favicon Workspace Badge', () => {
    // Samples average ARGB of a pixel region in the favicon dataURL; runs in-page for real Chromium decoding.
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

    // The 3x3 sample at (22,22) sits inside both the badge fill and the C-arc's empty interior
    // (radius <=11.3, inside the arc's inner radius of 12): transparent with no badge, colored with one.

    // SPEC: notify:favicon-workspace-badge
    // SPEC: notify:favicon-workspace-badge-color
    test('badge appears in bottom-right corner with workspace color when set', async ({ page }) => {
      // Deep red workspace color - distinguishable from arc gradient.
      const colorHex = '#c81818'
      await mockApiWithColor(page, colorHex)
      await mockSSE(page)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)

      // Badge occupies x,y in [18,30] on the 32x32 canvas; sampled [22..27]x[22..27] sits inside the fill.
      const pixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })
      // Expected #c81818 (r=200,g=24,b=24); +/-25 tolerance covers PNG quantisation and anti-aliasing.
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

      // Without a badge, the C-arc occupies the center, leaving this corner transparent (same region as above).
      const pixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })
      expect(pixel.a).toBeLessThan(50)
    })

    // SPEC: notify:favicon-workspace-badge-notification-dimmed
    test('badge renders at reduced opacity during notification state', async ({ page }) => {
      const controller = await createSSEController(page)
      await mockApiWithColor(page, '#c81818')
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Baseline must be captured before triggering; otherwise the post-trigger href is already the
      // notification variant and the poll-for-change below finds no delta.
      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .toMatch(/^data:image\/png/)
      const normalHref = await page.evaluate(() => document.querySelector('link[rel="icon"]').href)
      const normalPixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })

      // The notification favicon paints once the result arrives while hidden.
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

      await expect
        .poll(() => page.evaluate(() => document.querySelector('link[rel="icon"]').href))
        .not.toBe(normalHref)

      // globalAlpha=0.5 halves the badge's alpha (~255 -> ~127); assert at least a 30% drop.
      const notifPixel = await samplePixelInPage(page, { x: 22, y: 22, w: 3, h: 3 })

      expect(notifPixel.a).toBeLessThan(normalPixel.a * 0.7)
    })
  })
})
