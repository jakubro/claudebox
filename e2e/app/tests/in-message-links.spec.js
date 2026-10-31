/** E2E tests for links that point at another part of the same message. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'
import { DEFAULT_SESSION_URL } from '../mocks/api.js'

const message = (page, i) => page.locator('.turn-text').nth(i)

/** The page is still on this session's route; scrolling may add a turn segment, a jump adds nothing. */
function expectStillOnSession(page) {
  const hash = new URL(page.url()).hash
  expect(hash.startsWith(DEFAULT_SESSION_URL.slice(1))).toBe(true)
  expect(hash).toMatch(/^#\/workspaces\/[^#]*$/)
}

/** Click a link, then assert the jump landed on `target` inside the same message and stayed in this tab. */
async function expectJump(page, context, link, target, owner) {
  await link.click()

  await expect(target).toHaveClass(/jump-highlight/)
  expect(await target.evaluate((el, own) => own.contains(el), await owner.elementHandle())).toBe(
    true,
  )
  await expect
    .poll(() =>
      target.evaluate(el => {
        const top = el.getBoundingClientRect().top
        const box = document.querySelector('[data-testid="chat-messages"]').getBoundingClientRect()
        return top >= box.top - 1 && top < box.bottom
      }),
    )
    .toBe(true)
  expectStillOnSession(page)
  expect(context.pages()).toHaveLength(1)
}

test.describe('In-message links', () => {
  test.beforeEach(async ({ page }) => {
    await openSessionWithAPI(page, 'events/in-message-links.jsonl')
    await expect(message(page, 1)).toBeVisible()
  })

  // SPEC: chat:in-message-links
  test('a heading link scrolls to the heading, using GitHub slugs', async ({ page, context }) => {
    const first = message(page, 0)
    await expectJump(
      page,
      context,
      first.getByRole('link', { name: 'go to step 2' }),
      first.locator('h2', { hasText: 'Step 2: Run it!' }),
      first,
    )
  })

  // SPEC: chat:in-message-links
  test('a named anchor link scrolls to the anchor', async ({ page, context }) => {
    const first = message(page, 0)
    await expectJump(
      page,
      context,
      first.getByRole('link', { name: 'the anchor' }),
      first.locator('a[name="user-content-anchor-a"]'),
      first,
    )
  })

  // SPEC: chat:footnotes
  test('a footnote reference and its back-link jump within their own message', async ({
    page,
    context,
  }) => {
    const second = message(page, 1)
    const ref = second.locator('sup a').first()
    const note = second.locator('section.footnotes li').first()
    await expect(note).toContainText('Second source.')

    await expectJump(page, context, ref, note, second)
    await expectJump(page, context, note.locator('a[data-footnote-backref]'), ref, second)
  })

  test('a link to a missing target does nothing', async ({ page, context }) => {
    const link = message(page, 0).getByRole('link', { name: 'nowhere' })
    await link.scrollIntoViewIfNeeded()
    const top = await page.locator('[data-testid="chat-messages"]').evaluate(el => el.scrollTop)
    await link.click()

    await page.waitForTimeout(300)
    expectStillOnSession(page)
    expect(context.pages()).toHaveLength(1)
    expect(await page.locator('[data-testid="chat-messages"]').evaluate(el => el.scrollTop)).toBe(
      top,
    )
  })

  test('a web link still opens a new tab', async ({ page }) => {
    await expect(message(page, 0).getByRole('link', { name: 'web' })).toHaveAttribute(
      'target',
      '_blank',
    )
  })
})
