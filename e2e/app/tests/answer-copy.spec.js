/** E2E tests for the answer copy button at the end of a finished turn's closing row. */

import { expect, test } from '@playwright/test'
import { openSession } from '../helpers.js'
import { loadFixture, mockAPI } from '../mocks/api.js'

const turn = page => page.getByTestId('message-assistant')
const answerButton = page => turn(page).getByTitle('Copy message')

async function open(page, context, apiOptions = {}) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await mockAPI(page, apiOptions)
  await openSession(page, 'events/answer-copy.jsonl')
  await expect(turn(page)).toContainText('Final answer with')
}

test.describe('Answer copy', () => {
  // SPEC: chat:copy-button-answer
  test('a finished turn copies its answer from the right end of its closing row', async ({
    page,
    context,
  }) => {
    await open(page, context)

    const row = turn(page).locator('.turn-progress-complete')
    const rowBox = await row.boundingBox()
    const buttonBox = await answerButton(page).boundingBox()
    const contentBox = await turn(page).locator('.turn-content').boundingBox()
    expect(buttonBox.y).toBeGreaterThanOrEqual(rowBox.y)
    expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height)
    expect(contentBox.x + contentBox.width - (buttonBox.x + buttonBox.width)).toBeLessThanOrEqual(4)
    await expect(row).toContainText('worked for 3m')

    await answerButton(page).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Final answer with **bold**.',
    )
  })

  // SPEC: chat:copy-button-answer
  test("the answer's strip never touches the answer button", async ({ page, context }) => {
    await open(page, context)

    await turn(page).locator('.turn-text > p', { hasText: 'Final answer' }).hover()
    const strip = turn(page).getByTestId('block-strip').last()
    await expect(strip).toBeVisible()

    const a = await strip.boundingBox()
    const b = await answerButton(page).boundingBox()
    const overlaps =
      a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    expect(overlaps).toBe(false)
  })

  // SPEC: chat:copy-button-turn
  test('Copy turn still copies every text block of the turn', async ({ page, context }) => {
    await open(page, context)

    await turn(page).getByTitle('Copy turn').click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Let me check the parser first.\n\nFinal answer with **bold**.',
    )
  })

  // SPEC: chat:copy-button-answer
  test('collapsing the turn removes the answer button', async ({ page, context }) => {
    await open(page, context)
    await expect(answerButton(page)).toBeVisible()

    await turn(page).locator('.turn-meta').click()

    await expect(answerButton(page)).toHaveCount(0)
  })

  // SPEC: chat:copy-button-answer
  // SPEC: cost-display:capability-gated
  test('without cost telemetry the button still ends the turn', async ({ page, context }) => {
    await open(page, context, {
      handlers: {
        getSessionStatus: async route => {
          const status = loadFixture('status/default.json')
          status.capabilities.supports_cost_telemetry = false
          await route.fulfill({ json: status })
        },
      },
    })

    await expect(turn(page).getByText(/worked for/)).toHaveCount(0)
    const contentBox = await turn(page).locator('.turn-content').boundingBox()
    const buttonBox = await answerButton(page).boundingBox()
    expect(contentBox.x + contentBox.width - (buttonBox.x + buttonBox.width)).toBeLessThanOrEqual(4)
    expect(contentBox.y + contentBox.height - (buttonBox.y + buttonBox.height)).toBeLessThanOrEqual(
      12,
    )
  })
})
