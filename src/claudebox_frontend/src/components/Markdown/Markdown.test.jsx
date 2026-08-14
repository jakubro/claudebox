/** Tests for Markdown component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import Markdown from './Markdown'

// Real react-markdown - lightweight, pure rendering, no side effects

// Mock syntax highlighter (heavy, uses DOM APIs not available in jsdom)
vi.mock('react-syntax-highlighter', () => ({
  default: ({ children, language }) => (
    <pre data-testid="syntax-highlighter" data-language={language}>
      {children}
    </pre>
  ),
}))

vi.mock('react-syntax-highlighter/dist/esm/styles/hljs', () => ({
  vs2015: {},
}))

vi.mock('../CopyButton', () => ({
  default: ({ title, size }) => (
    <button data-testid="copy-button" title={title} data-size={size} type="button">
      Copy
    </button>
  ),
}))

vi.mock('remark-gfm', () => ({ default: () => {} }))
vi.mock('remark-math', () => ({ default: () => {} }))
vi.mock('rehype-katex', () => ({ default: () => {} }))

vi.mock('./components/MermaidDiagram', () => ({
  default: ({ chart }) => (
    <div data-testid="mermaid-diagram" data-chart={chart}>
      Mermaid
    </div>
  ),
}))

const mockSessionDir = { current: null }
vi.mock('../../context/SessionDataContext', () => ({
  useSessionDir: () => mockSessionDir.current,
  useSessionId: () => 'test-session',
}))

const mockResolvedPaths = { current: {} }
vi.mock('../../hooks/usePathResolution', () => ({
  default: () => mockResolvedPaths.current,
}))

describe('Markdown', () => {
  it('renders plain text', () => {
    render(<Markdown>Hello world</Markdown>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders markdown as HTML', () => {
    render(<Markdown>Some content</Markdown>)
    expect(screen.getByText('Some content')).toBeInTheDocument()
  })

  it('renders headings and paragraphs', () => {
    render(<Markdown>{'# Heading\n\nParagraph text'}</Markdown>)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Heading')
    expect(screen.getByText('Paragraph text')).toBeInTheDocument()
  })

  it('handles empty content', () => {
    const { container } = render(<Markdown>{''}</Markdown>)
    expect(container).toBeInTheDocument()
  })

  describe('code blocks', () => {
    it('renders block code with SyntaxHighlighter', () => {
      render(<Markdown>{'```js\nconsole.log("hi")\n```'}</Markdown>)

      expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
      expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'js')
      expect(screen.getByTestId('syntax-highlighter')).toHaveTextContent('console.log("hi")')
    })

    it('renders CopyButton for block code', () => {
      render(<Markdown>{'```python\nprint("hello")\n```'}</Markdown>)

      const copyBtn = screen.getByTestId('copy-button')
      expect(copyBtn).toBeInTheDocument()
      expect(copyBtn).toHaveAttribute('title', 'Copy code')
    })

    it('wraps block code with copy button', () => {
      render(<Markdown>{'```\nsome code\n```'}</Markdown>)

      expect(screen.getByTestId('copy-button')).toBeInTheDocument()
      expect(screen.getByTestId('syntax-highlighter')).toBeInTheDocument()
    })

    it('passes reduced size to code block CopyButton', () => {
      render(<Markdown>{'```js\nconst x = 1\n```'}</Markdown>)

      const copyBtn = screen.getByTestId('copy-button')
      expect(copyBtn).toHaveAttribute('data-size', '12')
    })

    it('renders inline code as plain code element', () => {
      render(<Markdown>{'Use `myVar` here'}</Markdown>)

      expect(screen.getByText('myVar')).toBeInTheDocument()
      expect(screen.queryByTestId('syntax-highlighter')).not.toBeInTheDocument()
    })

    it('does not render CopyButton for inline code', () => {
      render(<Markdown>{'Use `inlineCode` here'}</Markdown>)

      expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument()
    })
  })

  describe('mermaid blocks', () => {
    it('routes mermaid code blocks to MermaidDiagram', () => {
      render(<Markdown>{'```mermaid\ngraph TD\n    A --> B\n```'}</Markdown>)

      const diagram = screen.getByTestId('mermaid-diagram')
      expect(diagram).toBeInTheDocument()
      expect(diagram).toHaveAttribute('data-chart', 'graph TD\n    A --> B')
    })

    it('does not use SyntaxHighlighter for mermaid blocks', () => {
      render(<Markdown>{'```mermaid\ngraph TD\n    A --> B\n```'}</Markdown>)

      expect(screen.queryByTestId('syntax-highlighter')).not.toBeInTheDocument()
    })

    it('does not affect non-mermaid code blocks', () => {
      render(<Markdown>{'```python\nprint("hi")\n```'}</Markdown>)

      expect(screen.queryByTestId('mermaid-diagram')).not.toBeInTheDocument()
      expect(screen.getByTestId('syntax-highlighter')).toHaveAttribute('data-language', 'python')
    })
  })

  describe('/tmp path highlighting', () => {
    it('highlights /tmp/ paths in plain text', () => {
      mockSessionDir.current = '/host/sessions/abc'
      const { container } = render(<Markdown>File saved to /tmp/foo.log</Markdown>)
      mockSessionDir.current = null

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('/tmp/foo.log')
    })

    it('highlights /tmp/ paths in inline code', () => {
      mockSessionDir.current = '/host/sessions/abc'
      const { container } = render(<Markdown>{'File saved to `/tmp/foo.log`'}</Markdown>)
      mockSessionDir.current = null

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('/tmp/foo.log')
    })

    it('does not highlight /tmp/ paths when sessionDir is null', () => {
      mockSessionDir.current = null
      const { container } = render(<Markdown>File at /tmp/foo.log</Markdown>)

      expect(container.querySelector('.path-link')).toBeNull()
      expect(container).toHaveTextContent('File at /tmp/foo.log')
    })
  })

  describe('general path highlighting', () => {
    it('highlights resolved paths in plain text', () => {
      mockResolvedPaths.current = { 'docs/README.md': '/abs/docs/README.md' }
      const { container } = render(<Markdown>See docs/README.md for details</Markdown>)
      mockResolvedPaths.current = {}

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('docs/README.md')
    })

    it('highlights resolved paths in inline code', () => {
      mockResolvedPaths.current = { 'src/app.js': '/abs/src/app.js' }
      const { container } = render(<Markdown>{'Check `src/app.js` now'}</Markdown>)
      mockResolvedPaths.current = {}

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('src/app.js')
    })

    it('does not highlight when resolvedPaths is empty', () => {
      mockResolvedPaths.current = {}
      mockSessionDir.current = null
      const { container } = render(<Markdown>See docs/README.md for details</Markdown>)

      expect(container.querySelector('.path-link')).toBeNull()
    })
  })

  describe('element-override identity stability', () => {
    it('keeps the same DOM node for an unchanged code fence when surrounding markdown changes', () => {
      const { container, rerender } = render(
        <Markdown>{'intro\n\n```js\nconsole.log(1)\n```'}</Markdown>,
      )
      const before = container.querySelector('.code-block-wrapper')

      // Markdown text changes elsewhere while this fence's (code, language) stay identical.
      rerender(<Markdown>{'intro, updated\n\n```js\nconsole.log(1)\n```'}</Markdown>)

      const after = container.querySelector('.code-block-wrapper')
      expect(after).toBe(before)
    })
  })

  describe('raw HTML sanitization', () => {
    it('renders details/summary as real elements', () => {
      const { container } = render(
        <Markdown>{'<details><summary>More</summary>hidden body</details>'}</Markdown>,
      )

      expect(container.querySelector('details')).not.toBeNull()
      expect(container.querySelector('summary')).toHaveTextContent('More')
      expect(container).toHaveTextContent('hidden body')
    })

    it('renders presentational tags (kbd, sub, sup, mark, dl)', () => {
      const { container } = render(
        <Markdown>
          {
            '<kbd>Ctrl</kbd><sub>2</sub><sup>n</sup><mark>hi</mark><dl><dt>term</dt><dd>def</dd></dl>'
          }
        </Markdown>,
      )

      expect(container.querySelector('kbd')).toHaveTextContent('Ctrl')
      expect(container.querySelector('sub')).toHaveTextContent('2')
      expect(container.querySelector('sup')).toHaveTextContent('n')
      expect(container.querySelector('mark')).toHaveTextContent('hi')
      expect(container.querySelector('dl dt')).toHaveTextContent('term')
      expect(container.querySelector('dl dd')).toHaveTextContent('def')
    })

    it('renders a table with merged cells', () => {
      const { container } = render(
        <Markdown>
          {'<table><tbody><tr><td colspan="2">spanned</td></tr></tbody></table>'}
        </Markdown>,
      )

      const td = container.querySelector('td')
      expect(td).not.toBeNull()
      expect(td).toHaveAttribute('colspan', '2')
    })

    it('strips script tags', () => {
      const { container } = render(
        <Markdown>{'<script>window.__xss = true</script>safe text'}</Markdown>,
      )

      expect(container.querySelector('script')).toBeNull()
      expect(container).toHaveTextContent('safe text')
    })

    it('strips inline event handlers', () => {
      const { container } = render(
        <Markdown>{'<div onclick="window.__xss = true">click</div>'}</Markdown>,
      )

      expect(container.querySelector('[onclick]')).toBeNull()
      expect(container).toHaveTextContent('click')
    })

    it('strips iframe, svg, and object', () => {
      const { container } = render(
        <Markdown>
          {
            '<iframe src="https://evil"></iframe><svg><circle r="1" /></svg><object data="x"></object>'
          }
        </Markdown>,
      )

      expect(container.querySelector('iframe')).toBeNull()
      expect(container.querySelector('svg')).toBeNull()
      expect(container.querySelector('object')).toBeNull()
    })

    it('forces rel and target on links', () => {
      const { container } = render(<Markdown>{'<a href="https://example.com">ext</a>'}</Markdown>)

      const link = container.querySelector('a')
      expect(link).toHaveAttribute('target', '_blank')
      expect(link.getAttribute('rel')).toContain('noopener')
    })

    it('neutralizes javascript: links', () => {
      const { container } = render(
        <Markdown>{'<a href="javascript:window.__xss = true">x</a>'}</Markdown>,
      )

      const link = container.querySelector('a')
      expect(link?.getAttribute('href') ?? '').not.toContain('javascript:')
    })

    it('preserves inline style verbatim', () => {
      const { container } = render(<Markdown>{'<span style="color: red">styled</span>'}</Markdown>)

      const span = container.querySelector('span[style]')
      expect(span).not.toBeNull()
      expect(span.style.color).toBe('red')
    })
  })
})
