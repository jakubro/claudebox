/** Tests for the source spans Markdown tags its top-level blocks with, through the real pipeline. */

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Markdown from '../Markdown'

const SOURCE = '## Setup\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n$$\nx^2\n$$\n\n> quoted'

describe('Markdown top-level block spans', () => {
  it('tags each top-level block with the span of markdown it was written as', () => {
    const { container } = render(<Markdown className="md">{SOURCE}</Markdown>)

    const blocks = [...container.querySelector('.md').children]
    const slices = blocks.map(b => SOURCE.slice(Number(b.dataset.mdStart), Number(b.dataset.mdEnd)))
    expect(slices).toEqual([
      '## Setup',
      '| a | b |\n|---|---|\n| 1 | 2 |',
      '$$\nx^2\n$$',
      '> quoted',
    ])
  })

  it('keeps a display formula span although the math step replaces its element', () => {
    const { container } = render(<Markdown className="md">{SOURCE}</Markdown>)

    const formula = container.querySelector('.md > .katex-display')
    expect(formula.dataset.mdBlock).toBe('2')
    expect(formula.dataset.mdStart).toBeDefined()
  })

  it('gives a top-level quote its own copy button unless the host copies parts itself', () => {
    const own = render(<Markdown className="md">{'> quoted'}</Markdown>)
    expect(own.container.querySelector('blockquote > .blockquote-copy-btn')).not.toBeNull()

    const hosted = render(
      <Markdown className="md" hostsBlockActions>
        {'> quoted\n\n- item\n\n  > nested'}
      </Markdown>,
    )
    const quotes = hosted.container.querySelectorAll('blockquote')
    expect(quotes).toHaveLength(2)
    expect(quotes[0].querySelector(':scope > .blockquote-copy-btn')).toBeNull()
    expect(quotes[1].querySelector(':scope > .blockquote-copy-btn')).not.toBeNull()
  })
})
