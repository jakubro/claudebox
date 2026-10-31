/** Tests for remarkGithubAlerts. */

import { remark } from 'remark'
import remarkGfm from 'remark-gfm'
import { describe, expect, it } from 'vitest'
import remarkGithubAlerts from './remarkGithubAlerts'

const processor = remark().use(remarkGfm).use(remarkGithubAlerts)

/** The first top-level node's alert class list (null for none) and its first paragraph's text. */
function first(source) {
  const [quote] = processor.runSync(processor.parse(source)).children
  const paragraph = quote.children?.find(n => n.type === 'paragraph')
  return {
    className: quote.data?.hProperties?.className ?? null,
    text: paragraph?.children.map(n => n.value ?? '').join('') ?? null,
  }
}

describe('remarkGithubAlerts', () => {
  it('tags a top-level quote and drops its marker line', () => {
    expect(first('> [!WARNING]\n> Careful.')).toEqual({
      className: ['markdown-alert', 'markdown-alert-warning'],
      text: 'Careful.',
    })
  })

  it('accepts any case', () => {
    expect(first('> [!note]\n> x').className).toEqual(['markdown-alert', 'markdown-alert-note'])
  })

  it('keeps a marker-only alert as a header with no body', () => {
    expect(first('> [!TIP]')).toEqual({
      className: ['markdown-alert', 'markdown-alert-tip'],
      text: null,
    })
  })

  it.each([
    ['an unknown kind', '> [!TODO]\n> x', '[!TODO]\nx'],
    ['a marker not alone on its line', '> [!NOTE] inline', '[!NOTE] inline'],
    ['a marker after other text', '> intro\n> [!NOTE]', 'intro\n[!NOTE]'],
  ])('leaves %s as a plain quote', (_, source, text) => {
    expect(first(source)).toEqual({ className: null, text })
  })

  it('ignores an alert inside a list item', () => {
    const [list] = processor.runSync(processor.parse('- item\n  > [!NOTE]\n  > body')).children
    const quote = list.children[0].children[1]

    expect(quote.data?.hProperties).toBeUndefined()
  })
})
