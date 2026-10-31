/** Tests for the hover strip's pure derivations. */

import { describe, expect, it } from 'vitest'
import { partCopyText } from './blockStrip'

/** A top-level part element spanning `[start, end)` of its source. */
function part(tag, start, end, className = '', text = '') {
  const el = document.createElement(tag)
  el.dataset.mdStart = String(start)
  el.dataset.mdEnd = String(end)
  el.className = className
  el.textContent = text
  return el
}

describe('partCopyText', () => {
  const content = 'Intro.\n\n> quoted\n> - bullet\n\n> [!NOTE]\n> body'

  it('copies a paragraph exactly as written', () => {
    expect(partCopyText(part('p', 0, 6), content)).toBe('Intro.')
  })

  it('copies a quote without its own marker', () => {
    expect(partCopyText(part('blockquote', 8, 27), content)).toBe('quoted\n- bullet')
  })

  it("copies an alert's body only", () => {
    expect(partCopyText(part('blockquote', 29, 45, 'markdown-alert'), content)).toBe('body')
  })

  it('copies an HTML-written quote as its text', () => {
    const html = '<blockquote>raw <b>text</b></blockquote>'
    expect(partCopyText(part('blockquote', 0, html.length, '', ' raw text '), html)).toBe(
      'raw text',
    )
  })
})
