/** E2E tests for the card an agent's request to open a port shows. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

async function mockPortAnswer(page, reply, posted) {
  await page.route('**/api/workspaces/*/sessions/*/ports', async route => {
    posted.push(route.request().postDataJSON())
    await route.fulfill({ json: reply })
  })
}

test.describe('Port requests', () => {
  // SPEC: container:port-request
  test('a port request shows a card naming the port with Approve and Reject', async ({ page }) => {
    await openSessionWithAPI(page, 'events/port-request.jsonl')

    const card = page.getByTestId('port-request')
    await expect(card).toBeVisible()
    await expect(card).toHaveAttribute('data-port', '5173')
    await expect(card).toContainText('Open port 5173 to this computer?')
    await expect(card.getByRole('button', { name: 'Approve' })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Reject' })).toBeVisible()
  })

  // SPEC: container:port-card-answered
  test('approving shows the address and takes the buttons away', async ({ page }) => {
    const posted = []
    await mockPortAnswer(
      page,
      { port: 5173, host_port: 43210, address: 'http://127.0.0.1:43210' },
      posted,
    )
    await openSessionWithAPI(page, 'events/port-request.jsonl')

    const card = page.getByTestId('port-request')
    await card.getByRole('button', { name: 'Approve' }).click()

    await expect(card).toHaveText('Approved: port 5173 is reachable at http://127.0.0.1:43210.')
    await expect(card.getByRole('button')).toHaveCount(0)
    expect(posted).toEqual([{ port: 5173, approve: true }])
  })

  // SPEC: container:port-card-answered
  test('rejecting says the port stays closed and takes the buttons away', async ({ page }) => {
    const posted = []
    await mockPortAnswer(page, { port: 5173, state: 'rejected' }, posted)
    await openSessionWithAPI(page, 'events/port-request.jsonl')

    const card = page.getByTestId('port-request')
    await card.getByRole('button', { name: 'Reject' }).click()

    await expect(card).toHaveText('Rejected: port 5173 stays closed.')
    await expect(card.getByRole('button')).toHaveCount(0)
    expect(posted).toEqual([{ port: 5173, approve: false }])
  })

  // SPEC: container:port-card-answered
  test('an answered request shows its outcome after a reload, the answer plain in the user bubble', async ({
    page,
  }) => {
    await openSessionWithAPI(page, 'events/port-request-answered.jsonl')

    const card = page.getByTestId('port-request')
    await expect(card).toHaveText('Approved: port 5173 is reachable at http://127.0.0.1:5173.')
    await expect(card.getByRole('button')).toHaveCount(0)
    const answer = page.locator('.chat-message-user').nth(1)
    await expect(answer).toContainText('Approved: port 5173 is reachable at http://127.0.0.1:5173.')
    await expect(answer).not.toContainText('response:port_open')
  })
})
