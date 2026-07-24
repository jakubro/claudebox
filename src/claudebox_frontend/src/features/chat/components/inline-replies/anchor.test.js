/** Tests for text-quote anchoring: canonicalTurnText, captureAnchor, resolveAnchor. */

import { afterEach, describe, expect, it } from 'vitest'
import { canonicalTurnText, captureAnchor, resolveAnchor } from './anchor'

function roleWith(innerHtml) {
  const container = document.createElement('div')
  container.innerHTML = `<div data-testid="message-assistant">${innerHtml}</div>`
  document.body.appendChild(container)
  return container.querySelector('[data-testid="message-assistant"]')
}

function rangeOverText(textNode, quote) {
  const start = textNode.textContent.indexOf(quote)
  const range = document.createRange()
  range.setStart(textNode, start)
  range.setEnd(textNode, start + quote.length)
  return range
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('canonicalTurnText', () => {
  it('includes prose, tool output, and thinking text; excludes gutters and copy buttons', () => {
    const role = roleWith(
      '<div class="turn-text"><p>hello world</p>' +
        '<button class="turn-text-copy-btn">copy</button></div>' +
        '<div class="tool-block"><div class="tool-details">' +
        '<span class="code-block-gutter">12</span>ran a command</div></div>' +
        '<div class="thinking-block"><span class="thinking-content-inline"><p>a thought</p></span></div>' +
        '<div class="turn-text"><p>after tool</p></div>',
    )

    const { text } = canonicalTurnText(role)

    expect(text).toBe('hello worldran a commanda thoughtafter tool')
    expect(text).not.toContain('copy')
    // code-block line-number gutter is user-select:none, so it never appears in a real selection
    expect(text).not.toContain('12')
  })
})

describe('captureAnchor', () => {
  it('captures quote + surrounding context + offset from a Range', () => {
    const role = roleWith(
      '<div class="turn-text"><p id="p">the runtime embeds context window today</p></div>',
    )
    const textNode = role.querySelector('#p').firstChild

    const anchor = captureAnchor(rangeOverText(textNode, 'context window'), role)

    expect(anchor).toEqual({
      quote: 'context window',
      prefix: 'the runtime embeds ',
      suffix: ' today',
      offset: 19,
    })
  })

  it('returns null for a whitespace-only selection', () => {
    const role = roleWith('<div class="turn-text"><p id="p">   </p></div>')
    const textNode = role.querySelector('#p').firstChild

    expect(captureAnchor(rangeOverText(textNode, ' '), role)).toBeNull()
  })
})

describe('resolveAnchor', () => {
  it('relocates a span and returns a Range covering the quote', () => {
    const role = roleWith(
      '<div class="turn-text"><p>the runtime embeds context window today</p></div>',
    )

    const range = resolveAnchor(
      { quote: 'context window', prefix: 'embeds ', suffix: ' today', offset: 19 },
      role,
    )

    expect(range?.toString()).toBe('context window')
  })

  it('disambiguates a repeated quote using prefix/suffix context', () => {
    const role = roleWith('<div class="turn-text"><p>foo bar baz then foo bar qux</p></div>')

    const range = resolveAnchor(
      { quote: 'foo bar', prefix: 'then ', suffix: ' qux', offset: 17 },
      role,
    )

    // "then foo bar qux" starts at 12; the resolved quote begins at 17 (the second occurrence).
    expect(range?.toString()).toBe('foo bar')
    expect(range.startOffset).toBe(17)
  })

  it('falls back to offset-nearest for an ambiguous bare quote', () => {
    const role = roleWith('<div class="turn-text"><p>aa xx aa xx aa</p></div>')

    // "xx" occurs at 3 and 9; with no context the nearest to offset 9 wins.
    const range = resolveAnchor({ quote: 'xx', prefix: '', suffix: '', offset: 9 }, role)

    expect(range?.toString()).toBe('xx')
    expect(range.startOffset).toBe(9)
  })

  it('returns null when the quote no longer exists (source moved)', () => {
    const role = roleWith('<div class="turn-text"><p>completely different text</p></div>')

    expect(
      resolveAnchor({ quote: 'context window', prefix: '', suffix: '', offset: 0 }, role),
    ).toBeNull()
  })
})
