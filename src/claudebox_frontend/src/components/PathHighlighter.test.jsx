/** Tests for PathHighlighter component. */

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PathHighlighter from './PathHighlighter'

const SESSION_DIR = '/home/user/.claudebox/sessions/abc123'
const EDITOR_TEMPLATE = 'vscode://file/{path}:{line}'

/** Stub navigator.clipboard.writeText and return the mock. */
function stubClipboard() {
  const mockWriteText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mockWriteText },
    writable: true,
    configurable: true,
  })
  return mockWriteText
}

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

      expect(screen.getByTestId('child')).toHaveTextContent('/tmp/inside-element')
    })
  })

  describe('Alt+Click opens in editor', () => {
    const resolved = { 'config.toml': '/home/user/project/config.toml' }

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('plain click copies and flashes; Alt+Click does neither', () => {
      const mockWriteText = stubClipboard()
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})

      render(
        <PathHighlighter resolvedPaths={resolved} editorTemplate={EDITOR_TEMPLATE}>
          Edit config.toml
        </PathHighlighter>,
      )
      const path = screen.getByText('config.toml')

      fireEvent.click(path, { altKey: true })
      expect(mockWriteText).not.toHaveBeenCalled()
      expect(path).not.toHaveClass('copied')
      expect(openSpy).toHaveBeenCalledOnce()

      fireEvent.click(path)
      expect(mockWriteText).toHaveBeenCalledWith('/home/user/project/config.toml')
      expect(path).toHaveClass('copied')
    })

    it('resolves the URI for the resolved absolute path, not the displayed candidate', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})

      render(
        <PathHighlighter resolvedPaths={resolved} editorTemplate={EDITOR_TEMPLATE}>
          Edit config.toml
        </PathHighlighter>,
      )
      fireEvent.click(screen.getByText('config.toml'), { altKey: true })

      expect(openSpy).toHaveBeenCalledWith(
        'vscode://file/%2Fhome%2Fuser%2Fproject%2Fconfig.toml:1',
        '_blank',
        'noopener,noreferrer',
      )
    })

    it('encodes a resolved path containing a space, even though the candidate token has none', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})
      const spacedResolved = { 'notes.md': '/home/user/my project/notes.md' }

      render(
        <PathHighlighter resolvedPaths={spacedResolved} editorTemplate={EDITOR_TEMPLATE}>
          See notes.md
        </PathHighlighter>,
      )
      fireEvent.click(screen.getByText('notes.md'), { altKey: true })

      expect(openSpy).toHaveBeenCalledWith(
        'vscode://file/%2Fhome%2Fuser%2Fmy%20project%2Fnotes.md:1',
        '_blank',
        'noopener,noreferrer',
      )
    })

    it('Alt+Click with no template copies, matching plain click', () => {
      const mockWriteText = stubClipboard()
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {})

      render(<PathHighlighter resolvedPaths={resolved}>Edit config.toml</PathHighlighter>)
      const path = screen.getByText('config.toml')
      fireEvent.click(path, { altKey: true })

      expect(openSpy).not.toHaveBeenCalled()
      expect(mockWriteText).toHaveBeenCalledWith('/home/user/project/config.toml')
      expect(path).toHaveClass('copied')
    })

    it('tooltip includes the Alt+Click hint only when a template is configured', () => {
      const { rerender } = render(
        <PathHighlighter resolvedPaths={resolved} editorTemplate={EDITOR_TEMPLATE}>
          Edit config.toml
        </PathHighlighter>,
      )
      expect(screen.getByText('config.toml')).toHaveAttribute(
        'title',
        '/home/user/project/config.toml\nAlt+Click to open in editor',
      )

      rerender(<PathHighlighter resolvedPaths={resolved}>Edit config.toml</PathHighlighter>)
      expect(screen.getByText('config.toml')).toHaveAttribute(
        'title',
        '/home/user/project/config.toml',
      )
    })
  })
})
