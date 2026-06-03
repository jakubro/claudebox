/** Tests for MarkdownPreview component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import MarkdownPreview from './MarkdownPreview'

// Mock Markdown to avoid pulling in full markdown pipeline
vi.mock('../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown-rendered">{children}</div>,
}))

// Mock SyntaxHighlightedCodeBlock — source view uses the real code block component
vi.mock(
  './turn/components/tool-block/components/tool-block-expanded-content/components/tool-content-renderer/components/code-block',
  () => ({
    SyntaxHighlightedCodeBlock: ({ code, language, startingLineNumber }) => (
      <pre
        data-testid="syntax-highlighter"
        data-language={language}
        data-start={startingLineNumber}>
        {code}
      </pre>
    ),
  }),
)

// Mock CopyButton
vi.mock('../../../components/CopyButton.jsx', () => ({
  default: ({ text, title }) => (
    <button type="button" data-testid="copy-btn" data-text={text} title={title}>
      Copy
    </button>
  ),
}))

describe('MarkdownPreview', () => {
  const content = '# Hello\n\nThis is **markdown** content.'

  it('renders markdown by default', () => {
    render(<MarkdownPreview content={content} />)

    expect(screen.getByTestId('markdown-rendered')).toBeInTheDocument()
    expect(screen.queryByTestId('syntax-highlighter')).not.toBeInTheDocument()
  })

  it('toggles to source view on button click', () => {
    render(<MarkdownPreview content={content} />)

    const toggleBtn = screen.getByTitle('Show source')
    fireEvent.click(toggleBtn)

    expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-rendered')).not.toBeInTheDocument()
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'markdown')
  })

  it('toggles back to rendered view', () => {
    render(<MarkdownPreview content={content} />)

    const toggleBtn = screen.getByTitle('Show source')
    fireEvent.click(toggleBtn)
    fireEvent.click(screen.getByTitle('Show rendered'))

    expect(screen.getByTestId('markdown-rendered')).toBeInTheDocument()
  })

  it('passes content to CopyButton', () => {
    render(<MarkdownPreview content={content} />)

    const copyBtn = screen.getByTestId('copy-btn')
    expect(copyBtn).toHaveAttribute('data-text', content)
  })

  it('toggle button has pressed class in source view', () => {
    render(<MarkdownPreview content={content} />)

    const toggleBtn = screen.getByTitle('Show source')
    expect(toggleBtn).not.toHaveClass('pressed')

    fireEvent.click(toggleBtn)
    expect(screen.getByTitle('Show rendered')).toHaveClass('pressed')
  })

  it('passes startingLineNumber to source view', () => {
    render(<MarkdownPreview content={content} startingLineNumber={42} />)

    fireEvent.click(screen.getByTitle('Show source'))
    expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-start', '42')
  })
})
