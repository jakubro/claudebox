/** Tests for ToolCodeBlock component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ToolCodeBlock from './ToolCodeBlock'

describe('ToolCodeBlock', () => {
  it('returns null for empty details', () => {
    const { container } = render(<ToolCodeBlock toolName="Read" details="" />)

    expect(container.querySelector('.code-block')).toBeNull()
  })

  it('returns null for null details', () => {
    const { container } = render(<ToolCodeBlock toolName="Read" details={null} />)

    expect(container.firstChild).toBeNull()
  })

  describe('Read tool', () => {
    it('renders Read output with line numbers in gutter', () => {
      const details = '     1\u2192# Heading\n     2\u2192\n     3\u2192Body text'
      const { container } = render(<ToolCodeBlock toolName="Read" details={details} />)

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums).toHaveLength(3)
      expect(lineNums[0]).toHaveTextContent('1')
      expect(lineNums[2]).toHaveTextContent('3')
      expect(screen.getByText('# Heading')).toBeInTheDocument()
    })
  })

  describe('Write tool', () => {
    it('renders Write output with line numbers in gutter', () => {
      const details = ' 1\u2192const x = 1\n 2\u2192const y = 2'
      const { container } = render(<ToolCodeBlock toolName="Write" details={details} />)

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums).toHaveLength(2)
      expect(screen.getByText('const x = 1')).toBeInTheDocument()
    })
  })

  describe('Grep tool', () => {
    it('renders single-file grep with match highlighting', () => {
      const details = '93:  overflow: hidden;\n94-  text-overflow: ellipsis;'
      const { container } = render(<ToolCodeBlock toolName="Grep" details={details} />)

      expect(container.querySelector('.code-block-type-match')).toBeInTheDocument()
      expect(container.querySelector('.code-block-type-context')).toBeInTheDocument()
      expect(container.querySelectorAll('.code-block-linenum')).toHaveLength(2)
    })

    it('renders multi-file grep with file column showing basenames', () => {
      const details =
        'src/styles/tools.css:93:  overflow: hidden;\nsrc/styles/chat.css:211:  overflow: hidden;'
      const { container } = render(<ToolCodeBlock toolName="Grep" details={details} />)

      expect(container.querySelectorAll('.code-block-file')).toHaveLength(2)
      expect(screen.getByText('tools.css')).toBeInTheDocument()
      expect(screen.getByText('chat.css')).toBeInTheDocument()
    })

    it('toggles between basename and full path on file cell click', () => {
      const details = 'src/styles/tools.css:93:  overflow: hidden;'
      const { container } = render(<ToolCodeBlock toolName="Grep" details={details} />)

      // Initially shows basename
      expect(screen.getByText('tools.css')).toBeInTheDocument()

      // Click on file cell to toggle
      const fileCell = container.querySelector('.code-block-file')
      fireEvent.click(fileCell)

      // Now shows full path
      expect(screen.getByText('src/styles/tools.css')).toBeInTheDocument()

      // Click again to toggle back
      fireEvent.click(container.querySelector('.code-block-file'))
      expect(screen.getByText('tools.css')).toBeInTheDocument()
    })

    it('does not toggle paths when clicking non-file cells', () => {
      const details = 'src/styles/tools.css:93:  overflow: hidden;'
      const { container } = render(<ToolCodeBlock toolName="Grep" details={details} />)

      const contentCell = container.querySelector('.code-block-content')
      fireEvent.click(contentCell)

      // Still shows basename
      expect(screen.getByText('tools.css')).toBeInTheDocument()
    })

    it('renders separator between groups', () => {
      const details = '93:  overflow: hidden;\n--\n211:  overflow: hidden;'
      const { container } = render(<ToolCodeBlock toolName="Grep" details={details} />)

      expect(container.querySelector('.code-block-separator')).toBeInTheDocument()
    })

    it('renders files-only output without summary line', () => {
      const details = 'Found 3 files\nsrc/a.js\nsrc/b.js\nsrc/c.js'
      render(<ToolCodeBlock toolName="Grep" details={details} outputMode="files_with_matches" />)

      expect(screen.queryByText('Found 3 files')).not.toBeInTheDocument()
      expect(screen.getByText('src/a.js')).toBeInTheDocument()
      expect(screen.getByText('src/b.js')).toBeInTheDocument()
      expect(screen.getByText('src/c.js')).toBeInTheDocument()
    })
  })

  describe('Edit tool', () => {
    it('renders edit diff with add/remove/context line types', () => {
      const details =
        '  const foo = "bar"\n- const baz = 42\n+ const baz = 99\n  export { foo, baz }'
      const { container } = render(<ToolCodeBlock toolName="Edit" details={details} />)

      expect(container.querySelectorAll('.code-block-type-diff-context')).toHaveLength(2)
      expect(container.querySelector('.code-block-type-diff-remove')).toBeInTheDocument()
      expect(container.querySelector('.code-block-type-diff-add')).toBeInTheDocument()
      // Gutter with line numbers for context and remove lines
      expect(container.querySelectorAll('.code-block-gutter')).toHaveLength(4)
    })

    it('renders inline diff highlighting for paired lines', () => {
      const details = '- const baz = 42\n+ const baz = 99'
      const { container } = render(<ToolCodeBlock toolName="Edit" details={details} />)

      expect(container.querySelector('.diff-inline-removed')).toBeInTheDocument()
      expect(container.querySelector('.diff-inline-added')).toBeInTheDocument()
    })

    it('renders separator lines for · prefix', () => {
      const details = '  context\n· · ·\n  more context'
      const { container } = render(<ToolCodeBlock toolName="Edit" details={details} />)

      expect(container.querySelector('.code-block-separator')).toBeInTheDocument()
    })
  })

  describe('unknown tool', () => {
    it('renders plain lines for unknown tools', () => {
      const details = 'line 1\nline 2\nline 3'
      const { container } = render(<ToolCodeBlock toolName="Unknown" details={details} />)

      expect(container.querySelectorAll('.code-block-row')).toHaveLength(3)
      expect(container.querySelectorAll('.code-block-gutter')).toHaveLength(0)
      expect(screen.getByText('line 1')).toBeInTheDocument()
    })
  })
})
