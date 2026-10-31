/** E2E tests for GeoJSON and TopoJSON blocks drawn as maps, offline until the reader loads tiles. */

import { expect, test } from '@playwright/test'
import { openSessionWithAPI } from '../helpers.js'

const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

/** Load the fixture, recording every request leaving the app's origin. */
async function openMaps(page) {
  const external = []
  page.on('request', req => {
    const url = req.url()
    // The app's own service-status check is not the map's.
    if (
      !(url.startsWith('http://localhost:5173') || url.startsWith('https://status.claude.com/'))
    ) {
      external.push(url)
    }
  })
  await page.route('https://tile.openstreetmap.org/**', route =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TILE }),
  )
  await openSessionWithAPI(page, 'events/geo-maps.jsonl')
  const maps = page.locator('.geo-map')
  await expect(maps).toHaveCount(3)
  return { external, maps }
}

/** The drawn outline of the map's first shape - it changes whenever the map zooms. */
const shapeOf = locator => locator.locator('path.leaflet-interactive').first().getAttribute('d')

test.describe('Geo maps', () => {
  // SPEC: chat:geo-map
  // SPEC: chat:geo-map-render
  // SPEC: chat:geo-map-offline
  test('each valid block draws its shapes with no request outside the app', async ({ page }) => {
    const { external, maps } = await openMaps(page)

    await expect
      .poll(() => maps.nth(0).locator('path.leaflet-interactive').count())
      .toBeGreaterThanOrEqual(3)
    await expect.poll(() => maps.nth(1).locator('path.leaflet-interactive').count()).toBe(2)
    await expect.poll(() => maps.nth(2).locator('path.leaflet-interactive').count()).toBe(1)
    await expect(maps.nth(0).locator('.leaflet-tile')).toHaveCount(0)
    expect(external).toEqual([])
  })

  // SPEC: chat:geo-map-properties
  test('clicking a shape lists its properties as plain text', async ({ page }) => {
    const { maps } = await openMaps(page)
    const point = maps.nth(0).locator('path.leaflet-interactive').last()

    await point.click({ force: true })

    await expect(maps.nth(0).locator('.leaflet-popup-content')).toHaveText('name: <b>x</b>')
  })

  // SPEC: chat:geo-map-zoom-pan
  // SPEC: chat:geo-map-wheel
  test('the controls zoom, and the wheel scrolls the conversation instead', async ({ page }) => {
    const { maps } = await openMaps(page)
    const first = maps.nth(0)
    await expect.poll(() => first.locator('path.leaflet-interactive').count()).toBeGreaterThan(0)

    const before = await shapeOf(first)
    await first.locator('.leaflet-control-zoom-in').click()
    await expect.poll(() => shapeOf(first)).not.toBe(before)

    const zoomed = await shapeOf(first)
    const scroller = page.locator('[data-testid="chat-messages"]')
    await scroller.evaluate(el => {
      el.scrollTop = 0
    })
    const top = await scroller.evaluate(el => el.scrollTop)
    await first.hover()
    await page.mouse.wheel(0, 300)
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(top)
    expect(await shapeOf(first)).toBe(zoomed)
  })

  // SPEC: chat:geo-map-load-tiles
  test('"Load map" adds tiles and attribution to that map only', async ({ page }) => {
    const { external, maps } = await openMaps(page)

    await maps.nth(0).getByRole('button', { name: 'Load map' }).click()

    await expect.poll(() => maps.nth(0).locator('img.leaflet-tile').count()).toBeGreaterThan(0)
    await expect(maps.nth(0)).toContainText('OpenStreetMap')
    await expect(maps.nth(0).getByRole('button', { name: 'Load map' })).toHaveCount(0)
    expect(external.every(url => url.startsWith('https://tile.openstreetmap.org/'))).toBe(true)
    expect(external.length).toBeGreaterThan(0)
    await expect(maps.nth(2).locator('.leaflet-tile')).toHaveCount(0)
    await expect(maps.nth(2).getByRole('button', { name: 'Load map' })).toHaveCount(1)
  })

  // SPEC: chat:geo-map-toggle
  test('the source toggle swaps in highlighted JSON and back, and copy copies the source', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const { maps } = await openMaps(page)
    const second = maps.nth(2)

    await second.hover()
    await second.getByTitle('Show source').click()
    await expect(second.locator('.leaflet-container')).toHaveCount(0)
    await expect(second).toContainText('"Point"')
    await second.getByTitle('Show map').click()
    await expect(second.locator('.leaflet-container')).toHaveCount(1)

    await second.hover()
    await second.getByTitle('Copy source').click()
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(JSON.parse(copied).geometry.type).toBe('Point')
  })

  // SPEC: chat:geo-map-fallback
  test('a block that cannot be drawn shows its source with a failure notice', async ({ page }) => {
    await openMaps(page)

    await expect(page.locator('.render-failure-text')).toContainText('Map failed to draw')
    await expect(page.locator('.code-block-wrapper', { hasText: '{ not json' })).toBeVisible()
  })

  // SPEC: chat:geo-map-fallback
  test('GeoJSON of a known type that the map cannot draw falls back too', async ({ page }) => {
    await openSessionWithAPI(page, 'events/geo-maps-undrawable.jsonl')

    await expect(page.locator('.render-failure-text')).toContainText('Map failed to draw')
    await expect(page.locator('.code-block-wrapper', { hasText: '"Point"' })).toBeVisible()
    await expect(page.locator('.geo-map')).toHaveCount(0)
  })

  test('the map and its attribution sit on the app surface, not the library default', async ({
    page,
  }) => {
    const { maps } = await openMaps(page)
    const first = maps.first()
    await expect(first.locator('path.leaflet-interactive').first()).toBeVisible()
    await first.getByRole('button', { name: 'Load map' }).click()
    const attribution = first.locator('.leaflet-control-attribution')
    await expect(attribution).toBeVisible()

    const surface = await first.evaluate(el => getComputedStyle(el).backgroundColor)
    const canvas = await first
      .locator('.geo-map-canvas')
      .evaluate(el => getComputedStyle(el).backgroundColor)
    const strip = await attribution.evaluate(el => getComputedStyle(el).backgroundColor)
    const tertiary = await page.evaluate(() => {
      const probe = document.createElement('span')
      probe.style.backgroundColor = 'var(--bg-tertiary)'
      document.body.append(probe)
      const value = getComputedStyle(probe).backgroundColor
      probe.remove()
      return value
    })
    expect(canvas).toBe(surface)
    expect(strip).toBe(tertiary)
  })
})
