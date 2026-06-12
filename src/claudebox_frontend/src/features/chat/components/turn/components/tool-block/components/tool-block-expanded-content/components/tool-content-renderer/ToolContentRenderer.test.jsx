/** Tests for ToolContentRenderer component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import ToolContentRenderer from './ToolContentRenderer'

describe('ToolContentRenderer', () => {
  describe('null handling', () => {
    it('returns null when details is null', () => {
      const { container } = render(<ToolContentRenderer toolName="Edit" details={null} />)
      expect(container.firstChild).toBeNull()
    })

    it('returns null when details is undefined', () => {
      const { container } = render(<ToolContentRenderer toolName="Edit" details={undefined} />)
      expect(container.firstChild).toBeNull()
    })
  })

  describe('Edit tool', () => {
    it('renders removal lines with diff-remove row type', () => {
      const details = '- old line'
      const { container } = render(<ToolContentRenderer toolName="Edit" details={details} />)

      expect(container.querySelector('.code-block-type-diff-remove')).toBeInTheDocument()
      expect(screen.getByText('old line')).toBeInTheDocument()
    })

    it('renders addition lines with diff-add row type', () => {
      const details = '+ new line'
      const { container } = render(<ToolContentRenderer toolName="Edit" details={details} />)

      expect(container.querySelector('.code-block-type-diff-add')).toBeInTheDocument()
      expect(screen.getByText('new line')).toBeInTheDocument()
    })

    it('renders separator lines', () => {
      const details = '· context'
      const { container } = render(<ToolContentRenderer toolName="Edit" details={details} />)

      expect(container.querySelector('.code-block-separator')).toBeInTheDocument()
    })

    it('renders context lines with diff-context row type', () => {
      const details = '  plain line'
      const { container } = render(<ToolContentRenderer toolName="Edit" details={details} />)

      expect(container.querySelector('.code-block-type-diff-context')).toBeInTheDocument()
      expect(screen.getByText('plain line')).toBeInTheDocument()
    })

    it('renders multiple diff lines correctly', () => {
      const details = '- removed\n+ added\n· separator\n  plain'
      const { container } = render(<ToolContentRenderer toolName="Edit" details={details} />)

      // Paired diff lines have inline highlighting
      expect(container.querySelector('.diff-inline-removed')).toHaveTextContent('removed')
      expect(container.querySelector('.diff-inline-added')).toHaveTextContent('added')
      expect(container.querySelector('.code-block-separator')).toBeInTheDocument()
      expect(screen.getByText('plain')).toBeInTheDocument()
    })
  })

  describe('Read tool', () => {
    it('renders line with arrow separator showing line number and content', () => {
      const details = '  10\u2192const x = 1'
      render(<ToolContentRenderer toolName="Read" details={details} />)

      // Line number and content should be visible
      expect(screen.getByText(/10/)).toBeInTheDocument()
      expect(screen.getByText(/const x = 1/)).toBeInTheDocument()
    })

    it('renders line with pipe separator showing line number and content', () => {
      const details = '   5│function foo()'
      render(<ToolContentRenderer toolName="Read" details={details} />)

      expect(screen.getByText(/5/)).toBeInTheDocument()
      expect(screen.getByText(/function foo/)).toBeInTheDocument()
    })

    it('renders plain lines without line number format', () => {
      const details = 'some plain text'
      render(<ToolContentRenderer toolName="Read" details={details} />)

      expect(screen.getByText('some plain text')).toBeInTheDocument()
    })
  })

  describe('Grep tool', () => {
    it('renders separator line (--) as ellipsis in gutter', () => {
      const details = '42:match\n--\n50:another'
      render(<ToolContentRenderer toolName="Grep" details={details} />)

      // Separator renders as … in the line number gutter
      expect(screen.getByText('…')).toBeInTheDocument()
    })

    it('renders match line with basename, line number, and content', () => {
      const details = 'src/app.js:42:const x = 1'
      const { container } = render(<ToolContentRenderer toolName="Grep" details={details} />)

      // Shows basename by default
      expect(screen.getByText('app.js')).toBeInTheDocument()
      expect(container.querySelector('.code-block-file')).toBeInTheDocument()
      expect(screen.getByText('42')).toBeInTheDocument()
      expect(screen.getByText('const x = 1')).toBeInTheDocument()
      // Match line has match type styling
      expect(container.querySelector('.code-block-type-match')).toBeInTheDocument()
    })

    it('renders context line with basename, line number, and content', () => {
      const details = 'src/app.js-40-// comment'
      const { container } = render(<ToolContentRenderer toolName="Grep" details={details} />)

      // Shows basename by default
      expect(screen.getByText('app.js')).toBeInTheDocument()
      expect(container.querySelector('.code-block-file')).toBeInTheDocument()
      expect(screen.getByText('40')).toBeInTheDocument()
      expect(screen.getByText('// comment')).toBeInTheDocument()
      // Context line has context type styling
      expect(container.querySelector('.code-block-type-context')).toBeInTheDocument()
    })

    it('renders standalone file path', () => {
      const details = 'src/components/App.jsx'
      render(<ToolContentRenderer toolName="Grep" details={details} />)

      expect(screen.getByText('src/components/App.jsx')).toBeInTheDocument()
    })

    it('renders plain lines', () => {
      const details = 'some other text'
      render(<ToolContentRenderer toolName="Grep" details={details} />)

      expect(screen.getByText('some other text')).toBeInTheDocument()
    })

    it('uses table layout with file column for multi-file grep', () => {
      const details = 'src/app.js:42:const x = 1'
      const { container } = render(<ToolContentRenderer toolName="Grep" details={details} />)

      expect(container.querySelector('.code-block')).toBeInTheDocument()
      expect(container.querySelector('.code-block-file')).toBeInTheDocument()
    })

    it('uses sticky gutter for single-file grep', () => {
      const details = '42:const x = 1'
      const { container } = render(<ToolContentRenderer toolName="Grep" details={details} />)

      // No file column, but has line number gutter
      expect(container.querySelector('.code-block-file')).not.toBeInTheDocument()
      expect(container.querySelector('.code-block-gutter')).toBeInTheDocument()
    })

    it('renders separator in multi-file mode', () => {
      const details = 'src/app.js:42:match\n--\nsrc/app.js:50:another'
      const { container } = render(<ToolContentRenderer toolName="Grep" details={details} />)

      const separator = container.querySelector('.code-block-separator')
      expect(separator).toBeInTheDocument()
      expect(separator.querySelector('.code-block-linenum')).toHaveTextContent('…')
    })

    it('hides gutter for files-only output', () => {
      const details = 'src/app.js\nsrc/utils.js'
      const { container } = render(
        <ToolContentRenderer toolName="Grep" details={details} outputMode="files_with_matches" />,
      )

      // Files-only has no gutter
      expect(container.querySelector('.code-block-gutter')).not.toBeInTheDocument()
    })

    it('hides summary line for files-only output', () => {
      const details = 'Found 9 files\nsrc/app.js\nsrc/utils.js'
      const { container } = render(
        <ToolContentRenderer toolName="Grep" details={details} outputMode="files_with_matches" />,
      )

      expect(container.querySelector('.code-block-gutter')).not.toBeInTheDocument()
      // Summary line should be hidden
      expect(screen.queryByText('Found 9 files')).not.toBeInTheDocument()
    })

    it('handles files-only output with Windows line endings', () => {
      const details = 'Found 2 files\r\nsrc/app.js\r\nsrc/utils.js\r\n'
      const { container } = render(
        <ToolContentRenderer toolName="Grep" details={details} outputMode="files_with_matches" />,
      )

      // Should still strip summary
      expect(screen.queryByText(/Found 2 files/)).not.toBeInTheDocument()
      expect(container.querySelector('.code-block')).toBeInTheDocument()
    })

    it('toggles between basename and full path on click', async () => {
      const user = userEvent.setup()
      const details = 'src/components/App.jsx:10:export default App'
      render(<ToolContentRenderer toolName="Grep" details={details} />)

      // Default: shows basename
      expect(screen.getByText('App.jsx')).toBeInTheDocument()

      // Click to expand to full path
      await user.click(screen.getByText('App.jsx'))
      expect(screen.getByText('src/components/App.jsx')).toBeInTheDocument()

      // Click again to collapse back to basename
      await user.click(screen.getByText('src/components/App.jsx'))
      expect(screen.getByText('App.jsx')).toBeInTheDocument()
    })
  })

  describe('WebSearch tool', () => {
    it('renders content as markdown via tool-markdown-content class', () => {
      const details = '## Search Results\n\n- [Example](https://example.com)'
      const { container } = render(<ToolContentRenderer toolName="WebSearch" details={details} />)

      expect(container.querySelector('.tool-markdown-content')).toBeInTheDocument()
      expect(container.querySelector('.turn-text')).toBeInTheDocument()
      // Should not fall through to generic CodeBlock
      expect(container.querySelector('.code-block')).not.toBeInTheDocument()
    })

    it('renders copy button', () => {
      const { container } = render(
        <ToolContentRenderer toolName="WebSearch" details="search results" />,
      )

      expect(container.querySelector('.tool-copy-btn')).toBeInTheDocument()
    })
  })

  describe('WebFetch tool', () => {
    it('renders content as markdown via tool-markdown-content class', () => {
      const details = '# Page Title\n\nSome fetched content with **bold** text.'
      const { container } = render(<ToolContentRenderer toolName="WebFetch" details={details} />)

      expect(container.querySelector('.tool-markdown-content')).toBeInTheDocument()
      expect(container.querySelector('.turn-text')).toBeInTheDocument()
      expect(container.querySelector('.code-block')).not.toBeInTheDocument()
    })

    it('renders copy button', () => {
      const { container } = render(
        <ToolContentRenderer toolName="WebFetch" details="fetched content" />,
      )

      expect(container.querySelector('.tool-copy-btn')).toBeInTheDocument()
    })
  })

  describe('unknown tool', () => {
    it('renders details as plain text for unknown tools', () => {
      const details = 'raw output content'
      render(<ToolContentRenderer toolName="Unknown" details={details} />)

      expect(screen.getByText('raw output content')).toBeInTheDocument()
    })

    it('auto-detects language and applies syntax highlighting for code content', () => {
      const details = '{"name": "test", "count": 42, "items": ["a", "b"], "active": true}'
      const { container } = render(<ToolContentRenderer toolName="Unknown" details={details} />)

      // Auto-detected content should NOT use plain pre fallback
      expect(container.querySelector('.codeblock-plain')).not.toBeInTheDocument()
      // SyntaxHighlighter renders <code> with highlighted <span> tokens
      expect(container.querySelector('code')).toBeInTheDocument()
      expect(container.querySelector('code span')).toBeInTheDocument()
    })
  })

  describe('markdown rendering', () => {
    it('routes Read tool with .md file to MarkdownPreview', () => {
      const details = '   1\u2192# Title\n   2\u2192\n   3\u2192Some **bold** text.'
      const { container } = render(
        <ToolContentRenderer toolName="Read" details={details} filePath="/app/README.md" />,
      )

      expect(container.querySelector('.markdown-preview-container')).toBeInTheDocument()
      // Should NOT render syntax-highlighted code block
      expect(container.querySelector('.code-block')).not.toBeInTheDocument()
    })

    it('routes Write tool with .mdx file to MarkdownPreview', () => {
      const details = '   1\u2192# Title'
      const { container } = render(
        <ToolContentRenderer toolName="Write" details={details} filePath="/app/doc.mdx" />,
      )

      expect(container.querySelector('.markdown-preview-container')).toBeInTheDocument()
    })

    it('routes Bash tool with markdown-like output to MarkdownPreview', () => {
      const details =
        '# Heading\n\nSome text with **bold** and a [link](https://example.com).\n\n- item one\n- item two'
      const { container } = render(<ToolContentRenderer toolName="Bash" details={details} />)

      expect(container.querySelector('.markdown-preview-container')).toBeInTheDocument()
    })

    it('does NOT route Bash tool with non-markdown output to MarkdownPreview', () => {
      const details = 'total 42\ndrwxr-xr-x 5 user staff 160 Jan 1 10:00 .'
      const { container } = render(<ToolContentRenderer toolName="Bash" details={details} />)

      expect(container.querySelector('.markdown-preview-container')).not.toBeInTheDocument()
    })

    it('does NOT route Edit tool to MarkdownPreview even for .md files', () => {
      const details = '- old line\n+ new line'
      const { container } = render(
        <ToolContentRenderer toolName="Edit" details={details} filePath="/app/README.md" />,
      )

      // Edit uses 'code' renderer, not 'syntax-or-code', so markdown check doesn't apply
      expect(container.querySelector('.markdown-preview-container')).not.toBeInTheDocument()
      expect(container.querySelector('.code-block')).toBeInTheDocument()
    })

    it('does NOT route Grep tool to MarkdownPreview', () => {
      const details = 'README.md:5:# Some heading'
      const { container } = render(<ToolContentRenderer toolName="Grep" details={details} />)

      expect(container.querySelector('.markdown-preview-container')).not.toBeInTheDocument()
    })
  })

  describe('syntax highlighting', () => {
    it('uses SyntaxHighlighter for Read tool with known file extension', () => {
      const details = '   1\u2192const x = 1'
      const { container } = render(
        <ToolContentRenderer toolName="Read" details={details} filePath="/app/test.js" />,
      )

      // Syntax highlighting uses unified code-block structure with gutter
      expect(container.querySelector('.code-block')).toBeInTheDocument()
      expect(container.querySelector('.code-block-gutter')).toBeInTheDocument()
      expect(container.querySelector('.code-block-linenum')).toHaveTextContent('1')
      // Syntax highlighting adds span with hljs-* classes for tokens
      expect(container.querySelector('.code-block-content span')).toBeInTheDocument()
    })

    it('uses SyntaxHighlighter for Write tool with known file extension', () => {
      const details = '   1\u2192def hello():'
      const { container } = render(
        <ToolContentRenderer toolName="Write" details={details} filePath="/app/test.py" />,
      )

      // Syntax highlighting uses unified code-block structure
      expect(container.querySelector('.code-block')).toBeInTheDocument()
      expect(container.querySelector('.code-block-gutter')).toBeInTheDocument()
      expect(container.querySelector('.code-block-content span')).toBeInTheDocument()
    })

    it('falls back to CodeBlock rendering for unknown file extensions', () => {
      const details = '   1\u2192some content'
      const { container } = render(
        <ToolContentRenderer toolName="Read" details={details} filePath="/app/test.unknown" />,
      )

      // Should render code-block (same structure for both highlighted and non-highlighted)
      expect(container.querySelector('.code-block')).toBeInTheDocument()
      expect(container.querySelector('.code-block-linenum')).toBeInTheDocument()
    })

    it('falls back to CodeBlock rendering when no filePath provided', () => {
      const details = '   1\u2192const x = 1'
      const { container } = render(<ToolContentRenderer toolName="Read" details={details} />)

      expect(container.querySelector('.code-block')).toBeInTheDocument()
      expect(container.querySelector('.code-block-linenum')).toBeInTheDocument()
    })

    it('handles special filenames like Dockerfile', () => {
      const details = '   1\u2192FROM node:18'
      const { container } = render(
        <ToolContentRenderer toolName="Read" details={details} filePath="/app/Dockerfile" />,
      )

      // Syntax highlighting uses unified code-block structure
      expect(container.querySelector('.code-block')).toBeInTheDocument()
      expect(container.querySelector('.code-block-gutter')).toBeInTheDocument()
      expect(container.querySelector('.code-block-content span')).toBeInTheDocument()
    })
  })

  describe('copy button', () => {
    it('renders copy button for tool details', () => {
      const { container } = render(<ToolContentRenderer toolName="Bash" details="output" />)

      expect(container.querySelector('.tool-copy-btn')).toBeInTheDocument()
    })

    it('copies plain details text when clicked', async () => {
      const user = userEvent.setup()
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })
      render(<ToolContentRenderer toolName="Bash" details="command output" />)

      await user.click(screen.getByTitle('Copy output'))

      expect(writeText).toHaveBeenCalledWith('command output')
    })

    it('copies code without line numbers for Read tool', async () => {
      const user = userEvent.setup()
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })
      const details = '   1\u2192const x = 1\n   2\u2192const y = 2'
      render(<ToolContentRenderer toolName="Read" details={details} />)

      await user.click(screen.getByTitle('Copy output'))

      expect(writeText).toHaveBeenCalledWith('const x = 1\nconst y = 2')
    })

    it('copies code for syntax-highlighted Read with known extension', async () => {
      const user = userEvent.setup()
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })
      const details = '   1\u2192const x = 1'
      render(<ToolContentRenderer toolName="Read" details={details} filePath="/app/test.js" />)

      await user.click(screen.getByTitle('Copy output'))

      expect(writeText).toHaveBeenCalledWith('const x = 1')
    })

    it('strips diff prefixes for Edit tool copy', async () => {
      const user = userEvent.setup()
      const writeText = vi.fn()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText },
        writable: true,
        configurable: true,
      })
      const details = '- old line\n+ new line\n· separator\nplain'
      render(<ToolContentRenderer toolName="Edit" details={details} />)

      await user.click(screen.getByTitle('Copy output'))

      // Strips prefixes, removes separator lines
      expect(writeText).toHaveBeenCalledWith('old line\nnew line\nplain')
    })
  })
})
