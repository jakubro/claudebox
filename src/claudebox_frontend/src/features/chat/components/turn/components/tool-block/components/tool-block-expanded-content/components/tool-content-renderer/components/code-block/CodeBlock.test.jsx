/** Tests for unified CodeBlock renderer. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CodeBlock from './CodeBlock'

describe('CodeBlock', () => {
  describe('null handling', () => {
    it('returns null for empty lines array', () => {
      const { container } = render(<CodeBlock lines={[]} />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null for null lines', () => {
      const { container } = render(<CodeBlock lines={null} />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null for undefined lines', () => {
      const { container } = render(<CodeBlock lines={undefined} />)

      expect(container.firstChild).toBeNull()
    })
  })

  describe('gutter inference', () => {
    it('shows lineNum column when any line has lineNum', () => {
      const lines = [
        { type: 'normal', content: 'hello', lineNum: 1 },
        { type: 'normal', content: 'world', lineNum: 2 },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums).toHaveLength(2)
      expect(lineNums[0]).toHaveTextContent('1')
      expect(lineNums[1]).toHaveTextContent('2')
    })

    it('shows file column when any line has file', () => {
      const lines = [
        { type: 'match', content: 'code', lineNum: 42, file: 'foo.js' },
        { type: 'context', content: 'more', lineNum: 43, file: 'foo.js' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const files = container.querySelectorAll('.code-block-file')
      expect(files).toHaveLength(2)
      expect(files[0]).toHaveTextContent('foo.js')
    })

    it('shows both file and lineNum columns in multi-file mode', () => {
      const lines = [
        { type: 'match', content: 'x = 1', lineNum: 10, file: 'a.js' },
        { type: 'match', content: 'x = 2', lineNum: 20, file: 'b.js' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelectorAll('.code-block-file')).toHaveLength(2)
      expect(container.querySelectorAll('.code-block-linenum')).toHaveLength(2)
    })

    it('renders no gutter cells when lines have no lineNum or file', () => {
      const lines = [
        { type: 'diff-add', content: '+ new line' },
        { type: 'diff-remove', content: '- old line' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelectorAll('.code-block-gutter')).toHaveLength(0)
      expect(container.querySelectorAll('.code-block-no-gutter')).toHaveLength(2)
    })

    it('shows lineNum cells for all rows even when some lines lack lineNum', () => {
      const lines = [
        { type: 'normal', content: 'line 1', lineNum: 1 },
        { type: 'normal', content: 'line 2' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums).toHaveLength(2)
      expect(lineNums[0]).toHaveTextContent('1')
      expect(lineNums[1]).toHaveTextContent('')
    })
  })

  describe('row type styling', () => {
    it('applies cb-type-normal class for normal lines', () => {
      const lines = [{ type: 'normal', content: 'hello', lineNum: 1 }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.code-block-type-normal')).toBeInTheDocument()
    })

    it('applies cb-type-match class for match lines', () => {
      const lines = [{ type: 'match', content: 'found', lineNum: 5 }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.code-block-type-match')).toBeInTheDocument()
    })

    it('applies cb-type-context class for context lines', () => {
      const lines = [{ type: 'context', content: 'nearby', lineNum: 6 }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.code-block-type-context')).toBeInTheDocument()
    })

    it('applies cb-type-diff-add class for diff-add lines', () => {
      const lines = [{ type: 'diff-add', content: '+ added' }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.code-block-type-diff-add')).toBeInTheDocument()
    })

    it('applies cb-type-diff-remove class for diff-remove lines', () => {
      const lines = [{ type: 'diff-remove', content: '- removed' }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.code-block-type-diff-remove')).toBeInTheDocument()
    })

    it('applies cb-type-diff-context class for diff-context lines', () => {
      const lines = [{ type: 'diff-context', content: '  unchanged' }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.code-block-type-diff-context')).toBeInTheDocument()
    })
  })

  describe('separator lines', () => {
    it('renders separator with ellipsis in linenum gutter', () => {
      const lines = [
        { type: 'match', content: 'first', lineNum: 10 },
        { type: 'separator' },
        { type: 'match', content: 'second', lineNum: 50 },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const separator = container.querySelector('.code-block-separator')
      expect(separator).toBeInTheDocument()
      expect(separator.querySelector('.code-block-linenum')).toHaveTextContent('…')
    })

    it('renders separator with empty gutter cells in multi-file mode', () => {
      const lines = [
        { type: 'match', content: 'code', lineNum: 10, file: 'a.js' },
        { type: 'separator' },
        { type: 'match', content: 'code', lineNum: 20, file: 'b.js' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const separator = container.querySelector('.code-block-separator')
      expect(separator.querySelector('.code-block-file')).toBeInTheDocument()
      expect(separator.querySelector('.code-block-linenum')).toHaveTextContent('…')
    })

    it('renders separator without gutter when no lines have gutter data', () => {
      const lines = [
        { type: 'diff-remove', content: '- old' },
        { type: 'separator' },
        { type: 'diff-add', content: '+ new' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const separator = container.querySelector('.code-block-separator')
      expect(separator).toBeInTheDocument()
      expect(separator.querySelector('.code-block-gutter')).not.toBeInTheDocument()
      expect(separator.querySelector('.code-block-content')).toBeInTheDocument()
    })
  })

  describe('content rendering', () => {
    it('renders string content', () => {
      const lines = [{ type: 'normal', content: 'const x = 42', lineNum: 1 }]
      render(<CodeBlock lines={lines} />)

      expect(screen.getByText('const x = 42')).toBeInTheDocument()
    })

    it('renders JSX content (for inline diff highlighting)', () => {
      const jsxContent = (
        <span>
          hello <span className="diff-inline-added">world</span>
        </span>
      )
      const lines = [{ type: 'diff-add', content: jsxContent }]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelector('.diff-inline-added')).toHaveTextContent('world')
    })

    it('renders empty string for lines with null content', () => {
      const lines = [{ type: 'normal', content: null, lineNum: 1 }]
      const { container } = render(<CodeBlock lines={lines} />)

      const contentCell = container.querySelector('.code-block-content')
      expect(contentCell).toHaveTextContent('')
    })
  })

  describe('table layout structure', () => {
    it('renders cb container with cb-row children', () => {
      const lines = [
        { type: 'normal', content: 'a', lineNum: 1 },
        { type: 'normal', content: 'b', lineNum: 2 },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const root = container.querySelector('.code-block')
      expect(root).toBeInTheDocument()
      expect(root.querySelectorAll('.code-block-row')).toHaveLength(2)
    })

    it('each row has cell children with cb-cell class', () => {
      const lines = [{ type: 'normal', content: 'hello', lineNum: 1 }]
      const { container } = render(<CodeBlock lines={lines} />)

      const row = container.querySelector('.code-block-row')
      const cells = row.querySelectorAll('.code-block-cell')
      // lineNum cell + content cell = 2
      expect(cells).toHaveLength(2)
    })

    it('multi-file row has two cells: gutter (containing file + linenum) + content', () => {
      const lines = [{ type: 'match', content: 'code', lineNum: 10, file: 'test.js' }]
      const { container } = render(<CodeBlock lines={lines} />)

      const cells = container.querySelectorAll('.code-block-cell')
      expect(cells).toHaveLength(2)
      expect(cells[0]).toHaveClass('code-block-gutter')
      expect(cells[0].querySelector('.code-block-file')).toHaveTextContent('test.js')
      expect(cells[0].querySelector('.code-block-linenum')).toHaveTextContent('10')
      expect(cells[1]).toHaveClass('code-block-content')
    })

    it('gutter cell is single sticky element containing linenum span', () => {
      const lines = [{ type: 'normal', content: 'x', lineNum: 1 }]
      const { container } = render(<CodeBlock lines={lines} />)

      const gutterCells = container.querySelectorAll('.code-block-gutter')
      expect(gutterCells).toHaveLength(1)
      expect(gutterCells[0].querySelector('.code-block-linenum')).toHaveTextContent('1')
    })
  })

  describe('className prop', () => {
    it('appends custom className to root element', () => {
      const lines = [{ type: 'normal', content: 'test' }]
      const { container } = render(<CodeBlock lines={lines} className="custom-class" />)

      const root = container.querySelector('.code-block')
      expect(root).toHaveClass('custom-class')
    })

    it('works without custom className', () => {
      const lines = [{ type: 'normal', content: 'test' }]
      const { container } = render(<CodeBlock lines={lines} />)

      const root = container.querySelector('.code-block')
      expect(root).toHaveClass('code-block')
    })
  })

  describe('mixed line types', () => {
    it('renders a realistic grep output with matches, context, and separators', () => {
      const lines = [
        { type: 'match', content: 'overflow: hidden;', lineNum: 93, file: 'tools.css' },
        { type: 'context', content: 'text-overflow: ellipsis;', lineNum: 94, file: 'tools.css' },
        { type: 'separator' },
        { type: 'match', content: 'overflow: hidden;', lineNum: 211, file: 'chat.css' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelectorAll('.code-block-type-match')).toHaveLength(2)
      expect(container.querySelectorAll('.code-block-type-context')).toHaveLength(1)
      expect(container.querySelectorAll('.code-block-separator')).toHaveLength(1)
      expect(screen.getAllByText('tools.css')).toHaveLength(2)
      expect(screen.getByText('chat.css')).toBeInTheDocument()
    })

    it('renders a realistic diff output without gutter', () => {
      const lines = [
        { type: 'diff-context', content: '  const foo = "bar"' },
        { type: 'diff-remove', content: '- const baz = 42' },
        { type: 'diff-add', content: '+ const baz = 99' },
        { type: 'diff-context', content: '  export { foo, baz }' },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      expect(container.querySelectorAll('.code-block-gutter')).toHaveLength(0)
      expect(container.querySelectorAll('.code-block-type-diff-context')).toHaveLength(2)
      expect(container.querySelector('.code-block-type-diff-remove')).toBeInTheDocument()
      expect(container.querySelector('.code-block-type-diff-add')).toBeInTheDocument()
    })

    it('renders Read/Write output with line numbers', () => {
      const lines = [
        { type: 'normal', content: '# Heading', lineNum: 1 },
        { type: 'normal', content: '', lineNum: 2 },
        { type: 'normal', content: 'Body text', lineNum: 3 },
      ]
      const { container } = render(<CodeBlock lines={lines} />)

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums).toHaveLength(3)
      expect(lineNums[0]).toHaveTextContent('1')
      expect(lineNums[2]).toHaveTextContent('3')
      expect(screen.getByText('# Heading')).toBeInTheDocument()
    })
  })
})
