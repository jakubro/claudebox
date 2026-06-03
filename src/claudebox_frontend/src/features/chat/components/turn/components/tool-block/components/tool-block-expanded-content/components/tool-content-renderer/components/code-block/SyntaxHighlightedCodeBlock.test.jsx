/** Tests for SyntaxHighlightedCodeBlock component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SyntaxHighlightedCodeBlock from './SyntaxHighlightedCodeBlock'

describe('SyntaxHighlightedCodeBlock', () => {
  describe('null handling', () => {
    it('returns null for empty code', () => {
      const { container } = render(<SyntaxHighlightedCodeBlock code="" language="javascript" />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null for null code', () => {
      const { container } = render(<SyntaxHighlightedCodeBlock code={null} language="javascript" />)

      expect(container.firstChild).toBeNull()
    })

    it('returns null for undefined code', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code={undefined} language="javascript" />,
      )

      expect(container.firstChild).toBeNull()
    })
  })

  describe('table layout structure', () => {
    it('renders code-block container', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="const x = 1" language="javascript" />,
      )

      expect(container.querySelector('.code-block')).toBeInTheDocument()
    })

    it('renders rows with gutter and content cells', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="const x = 1" language="javascript" />,
      )

      expect(container.querySelector('.code-block-row')).toBeInTheDocument()
      expect(container.querySelector('.code-block-gutter')).toBeInTheDocument()
      expect(container.querySelector('.code-block-content')).toBeInTheDocument()
    })

    it('renders one row per line of code', () => {
      const code = 'line 1\nline 2\nline 3'
      const { container } = render(<SyntaxHighlightedCodeBlock code={code} language="javascript" />)

      expect(container.querySelectorAll('.code-block-row')).toHaveLength(3)
    })
  })

  describe('line numbers', () => {
    it('shows line numbers starting from 1 by default', () => {
      // Use valid JS code that produces multiple tokens to ensure wrapLines works
      const code = 'const x = 1;\nconst y = 2;'
      const { container } = render(<SyntaxHighlightedCodeBlock code={code} language="javascript" />)

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums).toHaveLength(2)
      expect(lineNums[0]).toHaveTextContent('1')
      expect(lineNums[1]).toHaveTextContent('2')
    })

    it('respects startingLineNumber prop', () => {
      const code = 'const x = 1;\nconst y = 2;'
      const { container } = render(
        <SyntaxHighlightedCodeBlock code={code} language="javascript" startingLineNumber={10} />,
      )

      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums[0]).toHaveTextContent('10')
      expect(lineNums[1]).toHaveTextContent('11')
    })

    it('renders line numbers in gutter', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="const x = 1" language="javascript" />,
      )

      const gutter = container.querySelector('.code-block-gutter')
      expect(gutter.querySelector('.code-block-linenum')).toHaveTextContent('1')
    })
  })

  describe('syntax highlighting', () => {
    it('applies syntax highlighting to JavaScript code', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="const x = 1" language="javascript" />,
      )

      // Syntax highlighter creates spans with inline styles for tokens
      const content = container.querySelector('.code-block-content')
      expect(content.querySelector('span')).toBeInTheDocument()
    })

    it('applies syntax highlighting to Python code', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="def hello():\n    pass" language="python" />,
      )

      const content = container.querySelector('.code-block-content')
      expect(content.querySelector('span')).toBeInTheDocument()
    })

    it('renders code content', () => {
      render(<SyntaxHighlightedCodeBlock code="const x = 1" language="javascript" />)

      expect(screen.getByText(/const/)).toBeInTheDocument()
    })
  })

  describe('row type styling', () => {
    it('applies code-block-type-normal class to all rows', () => {
      const code = 'const x = 1;\nconst y = 2;'
      const { container } = render(<SyntaxHighlightedCodeBlock code={code} language="javascript" />)

      const rows = container.querySelectorAll('.code-block-type-normal')
      expect(rows).toHaveLength(2)
    })
  })

  describe('className prop', () => {
    it('appends custom className to root element', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="x = 1" language="javascript" className="custom-class" />,
      )

      const root = container.querySelector('.code-block')
      expect(root).toHaveClass('custom-class')
    })

    it('works without custom className', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="x = 1" language="javascript" />,
      )

      const root = container.querySelector('.code-block')
      expect(root).toHaveClass('code-block')
    })
  })

  describe('multiline code', () => {
    it('handles code with many lines', () => {
      const code = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n')
      const { container } = render(<SyntaxHighlightedCodeBlock code={code} language="javascript" />)

      expect(container.querySelectorAll('.code-block-row')).toHaveLength(100)
      // Check last line number
      const lineNums = container.querySelectorAll('.code-block-linenum')
      expect(lineNums[99]).toHaveTextContent('100')
    })

    it('handles empty lines in code', () => {
      const code = 'line 1\n\nline 3'
      const { container } = render(<SyntaxHighlightedCodeBlock code={code} language="javascript" />)

      expect(container.querySelectorAll('.code-block-row')).toHaveLength(3)
    })
  })

  describe('CSS variable for line number width', () => {
    it('sets --linenum-col-width CSS variable based on max line number', () => {
      const code = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n')
      const { container } = render(<SyntaxHighlightedCodeBlock code={code} language="javascript" />)

      const root = container.querySelector('.code-block')
      // 1000 has 4 digits
      expect(root.style.getPropertyValue('--linenum-col-width')).toBe('4ch')
    })

    it('uses minimum width of 4ch for small files', () => {
      const { container } = render(
        <SyntaxHighlightedCodeBlock code="line 1" language="javascript" />,
      )

      const root = container.querySelector('.code-block')
      expect(root.style.getPropertyValue('--linenum-col-width')).toBe('4ch')
    })
  })
})
