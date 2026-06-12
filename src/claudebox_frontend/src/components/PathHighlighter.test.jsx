/** Tests for PathHighlighter component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import PathHighlighter from './PathHighlighter'

const SESSION_DIR = '/home/user/.claudebox/sessions/abc123'

describe('PathHighlighter', () => {
  describe('/tmp path highlighting', () => {
    it('highlights /tmp/ path with dotted underline', () => {
      render(<PathHighlighter sessionDir={SESSION_DIR}>File saved to /tmp/foo.log</PathHighlighter>)

      const path = screen.getByText('/tmp/foo.log')
      expect(path).toHaveClass('path-link')
    })

    it('renders resolved host path as title', () => {
      render(<PathHighlighter sessionDir={SESSION_DIR}>Output at /tmp/output.txt</PathHighlighter>)

      const path = screen.getByText('/tmp/output.txt')
      expect(path).toHaveAttribute('title', `${SESSION_DIR}/tmp/output.txt`)
    })

    it('copies resolved host path on click', async () => {
      const user = userEvent.setup()
      const mockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      render(<PathHighlighter sessionDir={SESSION_DIR}>File at /tmp/foo.log</PathHighlighter>)

      await user.click(screen.getByText('/tmp/foo.log'))

      expect(mockWriteText).toHaveBeenCalledWith(`${SESSION_DIR}/tmp/foo.log`)
    })

    it('flashes copied class on click then removes it', () => {
      vi.useFakeTimers()
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        writable: true,
        configurable: true,
      })

      render(<PathHighlighter sessionDir={SESSION_DIR}>File at /tmp/foo.log</PathHighlighter>)

      const path = screen.getByText('/tmp/foo.log')
      path.click()

      expect(path).toHaveClass('copied')

      vi.advanceTimersByTime(600)
      expect(path).not.toHaveClass('copied')

      vi.useRealTimers()
    })

    it('highlights nested /tmp/ paths', () => {
      render(
        <PathHighlighter sessionDir={SESSION_DIR}>
          Created /tmp/dir/sub/file.txt and /tmp/other.log
        </PathHighlighter>,
      )

      expect(screen.getByText('/tmp/dir/sub/file.txt')).toHaveClass('path-link')
      expect(screen.getByText('/tmp/other.log')).toHaveClass('path-link')
    })

    it('highlights bare /tmp reference', () => {
      render(
        <PathHighlighter sessionDir={SESSION_DIR}>
          The issue is with /tmp specifically
        </PathHighlighter>,
      )

      expect(screen.getByText('/tmp')).toHaveClass('path-link')
    })
  })

  describe('resolved paths highlighting', () => {
    const resolved = {
      'docs/README.md': '/home/user/project/docs/README.md',
      'config.toml': '/home/user/project/config.toml',
    }

    it('highlights resolved path candidates', () => {
      render(
        <PathHighlighter resolvedPaths={resolved}>See docs/README.md for details</PathHighlighter>,
      )

      const path = screen.getByText('docs/README.md')
      expect(path).toHaveClass('path-link')
      expect(path).toHaveAttribute('title', '/home/user/project/docs/README.md')
    })

    it('highlights bare filename with resolved path', () => {
      render(<PathHighlighter resolvedPaths={resolved}>Edit config.toml</PathHighlighter>)

      const path = screen.getByText('config.toml')
      expect(path).toHaveClass('path-link')
    })

    it('does not highlight unresolved candidates', () => {
      const { container } = render(
        <PathHighlighter resolvedPaths={{}}>See docs/README.md for details</PathHighlighter>,
      )

      expect(container.querySelector('.path-link')).toBeNull()
    })

    it('copies resolved path on click', async () => {
      const user = userEvent.setup()
      const mockWriteText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockWriteText },
        writable: true,
        configurable: true,
      })

      render(<PathHighlighter resolvedPaths={resolved}>See docs/README.md</PathHighlighter>)

      await user.click(screen.getByText('docs/README.md'))

      expect(mockWriteText).toHaveBeenCalledWith('/home/user/project/docs/README.md')
    })
  })

  describe('mixed /tmp and resolved paths', () => {
    it('highlights both /tmp and resolved paths', () => {
      const resolved = { 'src/app.js': '/home/user/project/src/app.js' }

      render(
        <PathHighlighter sessionDir={SESSION_DIR} resolvedPaths={resolved}>
          See src/app.js and /tmp/output.log
        </PathHighlighter>,
      )

      expect(screen.getByText('src/app.js')).toHaveClass('path-link')
      expect(screen.getByText('/tmp/output.log')).toHaveClass('path-link')
    })
  })

  describe('exclusions and edge cases', () => {
    it('does not highlight URLs', () => {
      const { container } = render(
        <PathHighlighter sessionDir={SESSION_DIR} resolvedPaths={{}}>
          Visit https://github.com/foo
        </PathHighlighter>,
      )

      expect(container.querySelector('.path-link')).toBeNull()
    })

    it('passes children through when no sessionDir and no resolvedPaths', () => {
      const { container } = render(
        <PathHighlighter sessionDir={null} resolvedPaths={{}}>
          File at /tmp/foo.log
        </PathHighlighter>,
      )

      expect(container.querySelector('.path-link')).toBeNull()
      expect(container).toHaveTextContent('File at /tmp/foo.log')
    })

    it('passes non-string children through unchanged', () => {
      render(
        <PathHighlighter sessionDir={SESSION_DIR}>
          <span data-testid="child">/tmp/inside-element</span>
        </PathHighlighter>,
      )

      // Element children are not processed (only string children are)
      expect(screen.getByTestId('child')).toHaveTextContent('/tmp/inside-element')
    })
  })
})
