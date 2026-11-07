/** Tests for the classes and styles a message keeps, through the real markdown pipeline. */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Markdown from '../Markdown'

function draw(markdown) {
  return render(<Markdown className="md">{markdown}</Markdown>).container
}

describe('Markdown classes', () => {
  it('drops a class the app defines', () => {
    const container = draw('<div class="zoom-overlay turn-text">x</div>')

    const div = [...container.querySelectorAll('.md div')].find(el => el.textContent === 'x')
    expect(div.getAttribute('class')).toBeNull()
  })

  it("drops a class naming KaTeX's own output", () => {
    const container = draw('<span class="katex">x</span>')

    expect(container.querySelector('.katex')).toBeNull()
  })

  it('keeps a language class on code', () => {
    const container = draw('<code class="language-js">const x = 1</code>')

    expect(container.querySelector('.code-block-wrapper code.language-js')).not.toBeNull()
  })

  it('keeps alert classes on a quote and drops any other', () => {
    const container = draw(
      '<blockquote class="markdown-alert markdown-alert-note">a</blockquote>\n\n' +
        '<blockquote class="markdown-alert-evil">b</blockquote>',
    )

    const [note, evil] = container.querySelectorAll('blockquote')
    expect(note.classList.contains('markdown-alert-note')).toBe(true)
    expect(evil.classList.contains('markdown-alert-evil')).toBe(false)
  })

  it('still draws an alert written in markdown', () => {
    const container = draw('> [!WARNING]\n> Mind the gap')

    expect(container.querySelector('blockquote.markdown-alert-warning')).not.toBeNull()
  })

  it('keeps the task list classes', () => {
    const container = draw('- [x] done')

    expect(container.querySelector('ul.contains-task-list > li.task-list-item')).not.toBeNull()
  })

  it('keeps the footnote classes', () => {
    const container = draw('Claim[^1]\n\n[^1]: Source')

    expect(container.querySelector('section.footnotes')).not.toBeNull()
    expect(container.querySelector('a[data-footnote-backref]')).not.toBeNull()
  })

  it.each([
    ['inline dollars', '$x$'],
    ['double dollars', '$$x$$'],
    ['backtick math', '$`x`$'],
    ['math fence', '```math\nx\n```'],
  ])("typesets %s with KaTeX's own sizing intact", (_, markdown) => {
    const container = draw(markdown)

    const katex = container.querySelector('.katex')
    expect(katex).not.toBeNull()
    expect(katex.querySelector('[style]')).not.toBeNull()
  })
})

describe('Markdown styles', () => {
  it('keeps only the allowed declarations of a style', () => {
    const container = draw('<span style="color: red; position: fixed; inset: 0">x</span>')

    const span = container.querySelector('span[style]')
    expect(span.style.color).toBe('red')
    expect(span.style.position).toBe('')
    expect(span.style.inset).toBe('')
  })

  it('removes a style with nothing allowed in it', () => {
    const container = draw('<div style="position: fixed">x</div>')

    const div = [...container.querySelectorAll('.md div')].find(el => el.textContent === 'x')
    expect(div.hasAttribute('style')).toBe(false)
  })

  it('keeps the alignment of a table cell and drops its padding', () => {
    const container = draw(
      '<table><tbody><tr><td style="text-align: center; padding: 40px">cell</td></tr></tbody></table>',
    )

    const td = container.querySelector('td')
    expect(td.style.textAlign).toBe('center')
    expect(td.style.padding).toBe('')
  })
})

describe('Markdown root', () => {
  it('adds no wrapper of its own around the blocks', () => {
    const { container } = render(<Markdown>x</Markdown>)

    expect(container.firstChild.tagName).toBe('P')
  })
})
