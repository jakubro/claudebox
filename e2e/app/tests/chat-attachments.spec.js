/** E2E tests for media attachment input: drag-drop, paste, preview, and validation. */

import { expect, test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSE } from '../mocks/sse.js'

// Minimal 1x1 transparent PNG as base64
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

/** Drop a file onto .chat-input-wrapper via synthetic DragEvent. */
async function dropFile(page, name, type, base64Data) {
  await page.evaluate(
    ({ name, type, base64Data }) => {
      const el = document.querySelector('.chat-input-wrapper')
      const dataTransfer = new DataTransfer()
      const bytes = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0))
      const file = new File([bytes], name, { type })
      dataTransfer.items.add(file)
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    },
    { name, type, base64Data },
  )
}

test.describe('Attachments', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
  })

  // SPEC: input:attachment-preview
  test('shows attachment preview with thumbnail and remove button', async ({ page }) => {
    await dropFile(page, 'photo.png', 'image/png', TINY_PNG_B64)

    // Preview row should appear
    const preview = page.locator('[data-testid="attachment-preview"]')
    await expect(preview).toBeVisible()

    // Image thumbnail should render
    await expect(preview.locator('img.attachment-thumb')).toBeVisible()
    await expect(page.getByText('photo.png')).toBeVisible()

    // Remove button should dismiss the preview
    await page.locator('.attachment-remove').click()
    await expect(preview).not.toBeVisible()
  })

  // SPEC: input:attachment-preview
  test('non-image attachment shows extension badge', async ({ page }) => {
    await dropFile(page, 'report.pdf', 'application/pdf', btoa('JVBERi0xLjQK'))

    const preview = page.locator('[data-testid="attachment-preview"]')
    await expect(preview).toBeVisible()
    await expect(page.locator('.attachment-ext', { hasText: 'PDF' })).toBeVisible()
    await expect(page.locator('.attachment-name', { hasText: 'report.pdf' })).toBeVisible()
  })

  // SPEC: input:attachment-dragdrop
  test('shows drag-over visual state on file drag', async ({ page }) => {
    const wrapper = page.locator('.chat-input-wrapper')

    // Dispatch dragover event via evaluate (DataTransfer not available in Playwright dispatchEvent)
    await page.evaluate(() => {
      const el = document.querySelector('.chat-input-wrapper')
      const event = new DragEvent('dragover', { bubbles: true, dataTransfer: new DataTransfer() })
      el.dispatchEvent(event)
    })

    await expect(wrapper).toHaveClass(/drag-over/)

    // Dispatch dragleave
    await page.evaluate(() => {
      const el = document.querySelector('.chat-input-wrapper')
      const event = new DragEvent('dragleave', { bubbles: true, relatedTarget: document.body })
      el.dispatchEvent(event)
    })

    await expect(wrapper).not.toHaveClass(/drag-over/)
  })

  // SPEC: input:attachment-paste
  test('paste with file data adds attachment to preview', async ({ page }) => {
    const textarea = page.locator('[data-testid="chat-input"]')
    await textarea.focus()

    // Simulate paste event with file in clipboardData
    await page.evaluate(b64 => {
      const textarea = document.querySelector('[data-testid="chat-input"]')
      const dataTransfer = new DataTransfer()
      const file = new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'pasted.png', {
        type: 'image/png',
      })
      dataTransfer.items.add(file)

      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        clipboardData: dataTransfer,
      })
      textarea.dispatchEvent(pasteEvent)
    }, TINY_PNG_B64)

    // Preview should appear with pasted image
    const preview = page.locator('[data-testid="attachment-preview"]')
    await expect(preview).toBeVisible()
    await expect(page.getByText('pasted.png')).toBeVisible()
  })

  // SPEC: input:attachment-max-size
  test('rejects files exceeding 10MB with error', async ({ page }) => {
    // Create a file > 10MB via evaluate
    await page.evaluate(() => {
      const el = document.querySelector('.chat-input-wrapper')
      const dataTransfer = new DataTransfer()
      // 11MB file
      const buf = new ArrayBuffer(11 * 1024 * 1024)
      const file = new File([buf], 'huge.bin', { type: 'application/octet-stream' })
      dataTransfer.items.add(file)

      const event = new DragEvent('drop', { bubbles: true, dataTransfer })
      el.dispatchEvent(event)
    })

    // Error should appear in footer
    await expect(page.locator('.footer-error-text')).toContainText('10MB')
    // Preview should NOT appear (file was rejected)
    await expect(page.locator('[data-testid="attachment-preview"]')).not.toBeVisible()
  })

  // SPEC: input:attachment-types
  test('accepts any file type', async ({ page }) => {
    await dropFile(page, 'data.json', 'application/json', btoa('{"key":"value"}'))

    const preview = page.locator('[data-testid="attachment-preview"]')
    await expect(preview).toBeVisible()
    await expect(page.locator('.attachment-ext', { hasText: 'JSON' })).toBeVisible()
    await expect(page.locator('.attachment-name', { hasText: 'data.json' })).toBeVisible()
  })

  // SPEC: input:attachment
  test('sends attachments in API call with message', async ({ page }) => {
    const sendCalls = []
    await page.route('**/api/send', async route => {
      sendCalls.push(await route.request().postDataJSON())
      await route.fulfill({ status: 200, json: { success: true } })
    })

    // Add file via drop
    await dropFile(page, 'image.png', 'image/png', TINY_PNG_B64)

    // Type message and submit
    const textarea = page.locator('[data-testid="chat-input"]')
    await textarea.fill('Check this')
    await textarea.press('Enter')

    // Verify POST includes attachments
    await expect.poll(() => sendCalls.length).toBeGreaterThan(0)
    expect(sendCalls[0].prompt).toBe('Check this')
    expect(sendCalls[0].attachments).toHaveLength(1)
    expect(sendCalls[0].attachments[0].name).toBe('image.png')
    expect(sendCalls[0].attachments[0].type).toBe('image/png')
    expect(sendCalls[0].attachments[0].data).toBeTruthy()
  })
})

test.describe('Attachment Image Source', () => {
  // SPEC: chat:attachment-src
  test('image attachments use container-proxied URL when filename is present', async ({ page }) => {
    await mockAPI(page)
    // Mock the attachment endpoint to return an image
    await page.route('**/api/sessions/current/attachments/*', async route => {
      await route.fulfill({
        status: 200,
        body: Buffer.from(TINY_PNG_B64, 'base64'),
        contentType: 'image/png',
      })
    })
    await mockSSE(page, 'events/chat-with-stored-attachments.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)

    // Image attachment should be rendered
    const thumb = page.locator('.message-attachment-thumb').first()
    await expect(thumb).toBeVisible()

    // The src should be a container-proxied URL, not a data: URL
    const src = await thumb.getAttribute('src')
    expect(src).toMatch(
      /\/api\/workspaces\/[^/]+\/containers\/[^/]+\/api\/sessions\/current\/attachments\//,
    )
    expect(src).not.toMatch(/^data:/)
  })
})

test.describe('Attachment Zoom', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page, 'events/chat-with-attachments.jsonl')
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
  })

  // SPEC: chat:attachment-zoom
  test('clicking image attachment in history opens zoom overlay', async ({ page }) => {
    await page.locator('.message-attachment-thumb').first().click()

    await expect(page.locator('.attachment-zoom-overlay')).toBeVisible()
    await expect(page.locator('.attachment-zoom-content img')).toBeVisible()
  })

  // SPEC: chat:attachment-zoom-close
  test('Escape closes attachment zoom overlay', async ({ page }) => {
    await page.locator('.message-attachment-thumb').first().click()
    await expect(page.locator('.attachment-zoom-overlay')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(page.locator('.attachment-zoom-overlay')).not.toBeVisible()
  })

  // SPEC: chat:attachment-zoom-close
  test('backdrop click closes attachment zoom overlay', async ({ page }) => {
    await page.locator('.message-attachment-thumb').first().click()
    await expect(page.locator('.attachment-zoom-overlay')).toBeVisible()

    await page.locator('.attachment-zoom-overlay').click({ position: { x: 10, y: 10 } })
    await expect(page.locator('.attachment-zoom-overlay')).not.toBeVisible()
  })

  // SPEC: chat:attachment-zoom-close
  test('close button closes attachment zoom overlay', async ({ page }) => {
    await page.locator('.message-attachment-thumb').first().click()
    await expect(page.locator('.attachment-zoom-overlay')).toBeVisible()

    await page.locator('.zoom-overlay-close').click()
    await expect(page.locator('.attachment-zoom-overlay')).not.toBeVisible()
  })
})

test.describe('Attachment Input Extras', () => {
  test.beforeEach(async ({ page }) => {
    await mockAPI(page)
    await mockSSE(page)
    await page.goto(DEFAULT_SESSION_URL)
    await waitForAppReady(page)
  })

  // SPEC: input:attachment-dragdrop
  // Acceptable negative test: verifies drop zone boundary
  test('drop on chat area outside input does not add attachment', async ({ page }) => {
    // Drop file on .chat-panel (outside .chat-input-wrapper)
    await page.evaluate(b64 => {
      const el = document.querySelector('.chat-panel')
      const dataTransfer = new DataTransfer()
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const file = new File([bytes], 'stray.png', { type: 'image/png' })
      dataTransfer.items.add(file)
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }))
    }, TINY_PNG_B64)

    // Attachment preview should NOT appear
    await expect(page.locator('[data-testid="attachment-preview"]')).not.toBeVisible()
  })

  // SPEC: input:attachment
  test('clears attachment preview after submit', async ({ page }) => {
    await page.route('**/api/send', async route => {
      await route.fulfill({ status: 200, json: { success: true } })
    })

    // Add file via drop
    await dropFile(page, 'doc.txt', 'text/plain', btoa('hello'))

    await expect(page.locator('[data-testid="attachment-preview"]')).toBeVisible()

    // Submit
    const textarea = page.locator('[data-testid="chat-input"]')
    await textarea.fill('Here')
    await textarea.press('Enter')

    // Preview should be cleared
    await expect(page.locator('[data-testid="attachment-preview"]')).not.toBeVisible()
  })
})
