/** E2E tests for STL blocks drawn as interactive 3D models, entirely in the browser. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

/** Load the fixture, recording every request leaving the app's origin. */
async function openModels(page) {
  const external = []
  page.on('request', req => {
    const url = req.url()
    // The app's own service-status check is not the viewer's.
    if (
      !(url.startsWith('http://localhost:5173') || url.startsWith('https://status.claude.com/'))
    ) {
      external.push(url)
    }
  })
  await openSessionWithAPI(page, 'events/stl-viewer.jsonl')
  const viewers = page.locator('.stl-viewer')
  await expect(viewers).toHaveCount(2)
  return { external, viewers }
}

/** RGBA of the canvas's centre and top-left corner pixels, and of a 7x7 grid across it. */
function samplePixels(viewer) {
  return viewer.locator('canvas').evaluate(canvas => {
    const copy = document.createElement('canvas')
    copy.width = canvas.width
    copy.height = canvas.height
    const ctx = copy.getContext('2d')
    ctx.drawImage(canvas, 0, 0)
    const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data].join(',')
    const grid = []
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 8; j++) {
        grid.push(at((canvas.width * i) / 8, (canvas.height * j) / 8))
      }
    }
    return {
      center: at(canvas.width / 2, canvas.height / 2),
      corner: at(2, 2),
      grid: grid.join(';'),
    }
  })
}

test.describe('STL viewer', () => {
  // SPEC: chat:stl
  // SPEC: chat:stl-render
  // SPEC: chat:stl-offline
  test('each valid block draws its model with no request outside the app', async ({ page }) => {
    const { external, viewers } = await openModels(page)

    for (const i of [0, 1]) {
      const canvas = viewers.nth(i).locator('canvas')
      await expect(canvas).toBeVisible()
      const box = await canvas.boundingBox()
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      await expect
        .poll(async () => {
          const { center, corner } = await samplePixels(viewers.nth(i))
          return center !== corner
        })
        .toBe(true)
    }
    expect(external).toEqual([])
  })

  // SPEC: chat:stl-orbit
  // SPEC: chat:stl-reset
  // SPEC: chat:stl-wheel
  test('dragging turns the model, reset restores it, and the wheel scrolls the chat', async ({
    page,
  }) => {
    const { viewers } = await openModels(page)
    const cube = viewers.nth(0)
    const canvas = cube.locator('canvas')
    await expect
      .poll(async () => (await samplePixels(cube)).center !== (await samplePixels(cube)).corner)
      .toBe(true)
    const opening = await samplePixels(cube)

    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 40, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => (await samplePixels(cube)).grid).not.toBe(opening.grid)

    await cube.getByTitle('Reset view').click()
    await expect.poll(async () => (await samplePixels(cube)).grid).toBe(opening.grid)

    const scroller = page.locator('[data-testid="chat-messages"]')
    await scroller.evaluate(el => {
      el.scrollTop = 0
    })
    await cube.scrollIntoViewIfNeeded()
    const top = await scroller.evaluate(el => el.scrollTop)
    // The chat reads a wheel as the reader taking over the scroll, so the wheel must reach it.
    await scroller.evaluate(el => {
      window.__chatWheels = 0
      el.addEventListener('wheel', () => window.__chatWheels++, { passive: true })
    })
    const beforeWheel = await samplePixels(cube)
    await canvas.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(top)
    expect(await page.evaluate(() => window.__chatWheels)).toBeGreaterThan(0)
    expect((await samplePixels(cube)).grid).toBe(beforeWheel.grid)
  })

  // SPEC: chat:stl-toggle
  test('the source toggle swaps in the STL text and back, and copy copies it', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { viewers } = await openModels(page)
    const cube = viewers.nth(0)

    await cube.hover()
    await cube.getByTitle('Show source').click()
    await expect(cube.locator('canvas')).toHaveCount(0)
    await expect(cube).toContainText('facet normal')
    await cube.getByTitle('Show model').click()
    await expect(cube.locator('canvas')).toHaveCount(1)

    await cube.hover()
    await cube.getByTitle('Copy source').click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.startsWith('solid cube')).toBe(true)
  })

  // SPEC: chat:stl-fallback
  test('a block with no facets shows its source with a failure notice', async ({ page }) => {
    await openModels(page)

    await expect(page.locator('.render-failure-text')).toContainText('Model failed to draw')
    await expect(
      page.locator('.code-block-wrapper', { hasText: 'solid broken endsolid' }),
    ).toBeVisible()
  })
})
