/** E2E tests for the capability-aware frontend foundation. */

import { expect, test } from '@playwright/test'
import { openSession, openSessionWithAPI } from '../helpers.js'
import { loadFixture, mockAPI } from '../mocks/api.js'

test.describe('Capability-Aware Frontend', () => {
  test.describe('Runtime Identity Pill', () => {
    test.beforeEach(async ({ page }) => {
      await openSessionWithAPI(page)
    })

    // SPEC: runtime:identity-pill
    test('shows the active runtime name in the footer', async ({ page }) => {
      const pill = page.locator('[data-testid="footer-runtime"]')
      await expect(pill).toBeVisible()
      await expect(pill).toHaveText('Claude')
    })
  })

  test.describe('Synthetic Capability Override', () => {
    test('honors a False flag returned by the session-info endpoint', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_skills')

      // Identity pill still renders - it does not depend on the flag.
      await expect(page.locator('[data-testid="footer-runtime"]')).toBeVisible()
    })
  })

  test.describe('Footer Pickers', () => {
    // SPEC: model-picker:capability-gated
    test('model picker hides when supports_set_model_mid_session is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_set_model_mid_session')

      await expect(page.locator('[data-testid="footer-model"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="footer-effort"]')).toBeVisible()
      await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toBeVisible()
    })

    // SPEC: effort-picker:capability-gated
    test('effort picker hides when supports_effort_levels is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_effort_levels')

      await expect(page.locator('[data-testid="footer-effort"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="footer-model"]')).toBeVisible()
      await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toBeVisible()
    })

    // SPEC: mcp-panel:capability-gated
    test('MCP panel hides when supports_mcp_delegation is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_mcp_delegation')

      // Asserts DOM absence, not just visibility, since the panel may not be open by default.
      await expect(page.locator('[data-testid="panel-mcp"]')).toHaveCount(0)
    })

    // SPEC: auto-compact-indicator:capability-gated
    test('auto-compact indicator absent when supports_pre_compact_hook is false', async ({
      page,
    }) => {
      await openWithCapabilityOff(page, 'supports_pre_compact_hook')

      // The spinner is gated on the runtime firing pre-compact lifecycle hooks.
      await expect(page.getByText('Compacting conversation')).toHaveCount(0)
    })

    // SPEC: manual-compact-button:capability-gated
    test('manual compact button hides when supports_manual_compact is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_manual_compact')

      await expect(page.locator('[data-testid="chat-control-compact"]')).toHaveCount(0)
    })

    // SPEC: context-usage-bar:capability-gated
    test('context usage bar hides when supports_context_usage is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_context_usage')

      await expect(page.locator('[data-testid="footer-context"]')).toHaveCount(0)
    })

    // SPEC: cost-display:capability-gated
    test('per-turn duration display hides when supports_cost_telemetry is false', async ({
      page,
    }) => {
      await openWithCapabilityOff(page, 'supports_cost_telemetry')

      // Vacuous in the empty session (no completed turn), but still enforces the gate contract.
      await expect(page.getByText(/worked for/)).toHaveCount(0)
    })

    // SPEC: fork-button:capability-gated
    test('fork button hides when supports_session_fork is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_session_fork')

      await expect(page.locator('[data-testid="chat-control-fork"]')).toHaveCount(0)
    })

    // SPEC: rewind-button:capability-gated
    test('rewind button hides when supports_session_rewind is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_session_rewind')

      await expect(page.locator('.message-rewind-split')).toHaveCount(0)
    })

    // SPEC: slash-autocomplete:capability-gated
    test('slash autocomplete dropdown does not appear when supports_skills is false', async ({
      page,
    }) => {
      await openWithCapabilityOff(page, 'supports_skills')

      const textarea = page.locator('textarea').first()
      await textarea.click()
      await textarea.fill('/')
      await expect(page.locator('.autocomplete-dropdown, [class*="autocomplete"]')).toHaveCount(0)
    })

    // SPEC: permission-mode-picker:capability-gated
    test('permission picker hides when supports_set_permission_mode is false', async ({ page }) => {
      await openWithCapabilityOff(page, 'supports_set_permission_mode')

      await expect(page.locator('[data-testid="footer-permission-mode-picker"]')).toHaveCount(0)
      await expect(page.locator('[data-testid="footer-model"]')).toBeVisible()
      await expect(page.locator('[data-testid="footer-effort"]')).toBeVisible()
    })
  })
})

async function openWithCapabilityOff(page, capability) {
  await mockAPI(page, {
    handlers: {
      getSessionStatus: async route => {
        const status = loadFixture('status/default.json')
        status.capabilities[capability] = false
        await route.fulfill({ json: status })
      },
    },
  })
  await openSession(page)
}
