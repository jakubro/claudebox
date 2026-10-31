/** E2E tests for relative links and images in a message, resolved against the agent's working directory. */

import { expect, test } from '@playwright/test'
import { openLiveSession, openSession, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_ID, DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const PNG_2X2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
)
const SERVED = new Set(['out/plot.png', '/tmp/plot.png'])

/** Serve images for the paths in SERVED and 404 otherwise, recording every request's query. */
async function mockImages(page) {
  const requests = []
  await page.route('**/api/workspaces/*/files/image*', route => {
    const url = new URL(route.request().url())
    const { v, ...query } = Object.fromEntries(url.searchParams)
    requests.push(query)
    return SERVED.has(url.searchParams.get('path'))
      ? route.fulfill({ status: 200, contentType: 'image/png', body: PNG })
      : route.fulfill({ status: 404, json: { error: 'file_not_found' } })
  })
  return requests
}

const message = page => page.locator('.turn-text').first()

test.describe('Relative links and images', () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  })

  // SPEC: chat:relative-image
  // SPEC: chat:temp-image
  // SPEC: chat:relative-image-confined
  test('relative and /tmp images load through the workspace; escaping ones never load', async ({
    page,
  }) => {
    await mockAPI(page)
    const requests = await mockImages(page)
    await openSession(page, 'events/relative-links.jsonl')

    const plot = message(page).locator('img[alt="plot"]')
    await expect.poll(() => plot.evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
    const temp = message(page).locator('img[alt="temp"]')
    await expect.poll(() => temp.evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
    const raw = message(page).locator('img[width="40"]')
    await expect.poll(() => raw.evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
    expect(await raw.evaluate(img => img.getBoundingClientRect().width)).toBe(40)

    expect(requests).toContainEqual({ path: 'out/plot.png' })
    expect(requests).toContainEqual({ path: '/tmp/plot.png', session: DEFAULT_SESSION_ID })
    const outside = message(page).locator('img[alt="outside"]')
    await expect(outside).not.toHaveAttribute('src')
    expect(requests.some(r => r.path?.includes('outside'))).toBe(false)
  })

  // SPEC: chat:relative-link
  test('a relative link copies its full path, stays in this tab, and Alt+Click opens the editor', async ({
    page,
    context,
  }) => {
    await mockAPI(page)
    await mockImages(page)
    await mockSSE(page, 'events/relative-links.jsonl')
    await page.addInitScript(() => {
      window.__opened = []
      window.open = url => {
        window.__opened.push(url)
        return null
      }
    })
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    const guide = message(page).getByRole('link', { name: 'the guide' })
    await expect(guide).toHaveAttribute('title', /\/home\/user\/project\/docs\/guide\.md/)
    await guide.click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '/home/user/project/docs/guide.md',
    )
    await expect(guide).toHaveClass(/copied/)
    expect(context.pages()).toHaveLength(1)

    await guide.click({ modifiers: ['Alt'] })
    expect(await page.evaluate(() => window.__opened)).toEqual([
      'claudebox-editor-test://open?path=%2Fhome%2Fuser%2Fproject%2Fdocs%2Fguide.md&line=1',
    ])

    await message(page).getByRole('link', { name: 'the notes' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      '/home/user/project/my notes.md',
    )
  })

  // SPEC: chat:relative-link-confined
  // SPEC: chat:html-link-safe
  test('an escaping link is plain text and a web link still opens a new tab', async ({ page }) => {
    await mockAPI(page)
    await mockImages(page)
    await openSession(page, 'events/relative-links.jsonl')

    await expect(message(page).getByText('escape')).toBeVisible()
    await expect(message(page).locator('a', { hasText: 'escape' })).toHaveCount(0)
    await expect(message(page).getByRole('link', { name: 'web' })).toHaveAttribute(
      'target',
      '_blank',
    )
  })

  // SPEC: chat:relative-image-fresh
  test('a message showing a rewritten image again shows the new contents', async ({ page }) => {
    await mockAPI(page)
    let body = PNG
    await page.route('**/api/workspaces/*/files/image*', route =>
      route.fulfill({
        status: 200,
        contentType: 'image/png',
        body,
        headers: { 'Cache-Control': 'no-cache' },
      }),
    )
    const controller = await openLiveSession(page)

    const show = (id, turn) => [
      {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: 'Plot it',
        turn_id: turn,
        id: `${id}u`,
      },
      {
        type: 'assistant',
        subtype: 'text',
        content: '![plot](out/plot.png)',
        turn_id: turn,
        id: `${id}a`,
      },
      { type: 'result', subtype: 'success', turn_id: turn, id: `${id}r` },
    ]
    await controller.sendEvents(show('e1', 'turn_001'))
    const plots = page.locator('img[alt="plot"]')
    await expect.poll(() => plots.first().evaluate(img => img.naturalWidth)).toBe(1)

    body = PNG_2X2
    await controller.sendEvents(show('e2', 'turn_002'))
    await expect.poll(() => plots.last().evaluate(img => img.naturalWidth)).toBe(2)
  })

  // SPEC: chat:relative-path-preview
  test("a previewed markdown file's relative image resolves in that file's folder", async ({
    page,
  }) => {
    await mockAPI(page)
    const requests = await mockImages(page)
    await openSession(page, 'events/relative-links-preview.jsonl')

    await page.locator('[data-testid="tool-block"]').first().locator('.tool-header-area').click()
    await expect(page.locator('.markdown-preview-content img[alt="diagram"]')).toBeAttached()

    await expect.poll(() => requests.map(r => r.path)).toContain('docs/guide/img/d.png')

    await page.locator('[data-testid="tool-block"]').nth(1).locator('.tool-header-area').click()
    await expect.poll(() => requests.map(r => r.path)).toContain('img/b.png')
  })

  /** Expand the tool block whose header names `tool`. */
  async function expandTool(page, tool) {
    const block = page.locator('[data-testid="tool-block"]').filter({ hasText: tool }).first()
    await block.locator('.tool-header-area').click()
    return block
  }

  async function openOrigins(page) {
    await mockAPI(page)
    const requests = await mockImages(page)
    await page.route('https://example.com/**', route =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PNG }),
    )
    await openSession(page, 'events/relative-links-origins.jsonl')
    return requests
  }

  // SPEC: chat:relative-link-web
  test('a fetched page opens its relative links next to it and loads its images from the site', async ({
    page,
    context,
  }) => {
    const requests = await openOrigins(page)
    const block = await expandTool(page, 'WebFetch')

    const link = block.getByText('the agent guide')
    await expect(link).toHaveAttribute('href', 'https://example.com/project/docs/AGENTS.md')
    await expect(link).toHaveAttribute('target', '_blank')
    const opened = context.waitForEvent('page')
    await link.click()
    expect((await opened).url()).toBe('https://example.com/project/docs/AGENTS.md')
    const logo = block.locator('img[alt="logo"]')
    await expect.poll(() => logo.evaluate(img => img.naturalWidth)).toBeGreaterThan(0)
    expect(requests.some(r => r.path?.includes('logo'))).toBe(false)
  })

  // SPEC: chat:relative-link-skill
  test("a skill's relative link points into the skill's own folder", async ({ page }) => {
    await openOrigins(page)
    const block = await expandTool(page, 'Skill')

    const link = block.getByText('the reference')
    await expect(link).toHaveAttribute('title', /\/home\/user\/skills\/demo\/reference\.md/)
    await link.click()
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe('/home/user/skills/demo/reference.md')
  })

  // SPEC: chat:relative-link-unanchored
  test('a relative link in web search results is plain text', async ({ page }) => {
    await openOrigins(page)
    const block = await expandTool(page, 'WebSearch')

    const notes = block.locator('.tool-markdown-content').getByText('notes', { exact: true })
    await expect(notes).toBeVisible()
    expect(await notes.evaluate(el => Boolean(el.closest('a')))).toBe(false)
  })

  // SPEC: chat:relative-link-tool-output
  test('markdown a command prints loads its relative images from the working directory', async ({
    page,
  }) => {
    // A command's output shows expanded, so its image is asked for without a click.
    const requests = await openOrigins(page)

    await expect.poll(() => requests.map(r => r.path)).toContain('out/plot.png')
  })
})
