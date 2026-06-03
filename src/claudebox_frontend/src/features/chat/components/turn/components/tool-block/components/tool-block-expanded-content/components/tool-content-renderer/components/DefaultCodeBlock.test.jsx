/** Tests for DefaultCodeBlock component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import DefaultCodeBlock from './DefaultCodeBlock'

describe('DefaultCodeBlock', () => {
  it('returns null for empty content', () => {
    const { container } = render(<DefaultCodeBlock content="" />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null for null content', () => {
    const { container } = render(<DefaultCodeBlock content={null} />)

    expect(container.innerHTML).toBe('')
  })

  it('returns null for undefined content', () => {
    const { container } = render(<DefaultCodeBlock />)

    expect(container.innerHTML).toBe('')
  })

  it('renders plain pre for content', () => {
    render(<DefaultCodeBlock content="console.log('hello')" />)

    const pre = screen.getByText("console.log('hello')")
    expect(pre.tagName).toBe('PRE')
    expect(pre.className).toBe('codeblock-plain')
  })

  it('preserves whitespace in content', () => {
    const multiline = 'line 1\n  line 2\n    line 3'
    const { container } = render(<DefaultCodeBlock content={multiline} />)

    const pre = container.querySelector('pre')
    expect(pre.textContent).toBe(multiline)
  })

  it('renders syntax-highlighted code when filePath provides language hint', () => {
    const { container } = render(<DefaultCodeBlock content="def foo(): pass" filePath="test.py" />)

    const code = container.querySelector('code.language-python')
    expect(code).not.toBeNull()
    expect(code.textContent).toBe('def foo(): pass')
  })

  it('renders plain pre when markdown renderer provided but content is not markdown', () => {
    const MockMarkdown = ({ children }) => <div data-testid="markdown">{children}</div>
    render(<DefaultCodeBlock content="# Hello" renderer={{ markdown: MockMarkdown }} />)

    const pre = screen.getByText('# Hello')
    expect(pre.tagName).toBe('PRE')
    expect(screen.queryByTestId('markdown')).not.toBeInTheDocument()
  })
})
