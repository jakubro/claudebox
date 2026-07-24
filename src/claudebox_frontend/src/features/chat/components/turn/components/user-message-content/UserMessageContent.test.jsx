/** Tests for UserMessageContent component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import UserMessageContent from './UserMessageContent'

const mockSessionDir = { current: null }
const mockCommands = { current: { custom: [], mcp: [], builtin: [] } }
vi.mock('../../../../../../context/SessionDataContext', () => ({
  useSessionDir: () => mockSessionDir.current,
  useSessionId: () => 'test-session-id',
  useSessionData: () => ({ commands: mockCommands.current }),
}))

// Mock usePathResolution to control resolved paths in tests
const mockResolvedPaths = { current: {} }
vi.mock('../../../../../../hooks/usePathResolution', () => ({
  default: () => mockResolvedPaths.current,
}))

describe('UserMessageContent', () => {
  it('renders plain text message', () => {
    render(<UserMessageContent message="Hello world" />)

    expect(screen.getByText('Hello world')).toBeInTheDocument()
    expect(screen.getByText('Hello world')).toHaveClass('message-content')
  })

  it('renders slash command with styling', () => {
    render(<UserMessageContent message="<command-name>/help</command-name>" />)

    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/help')).toHaveClass('slash-command')
  })

  it('renders slash command with args', () => {
    render(
      <UserMessageContent message="<command-name>/scope</command-name><command-args>src/app</command-args>" />,
    )

    expect(screen.getByText(/\/scope/)).toBeInTheDocument()
    expect(screen.getByText(/src\/app/)).toBeInTheDocument()
  })

  it('wraps slash command + args in a single message-content bubble', () => {
    const { container } = render(
      <UserMessageContent message="<command-name>/scope</command-name><command-args>src/app</command-args>" />,
    )

    // One outer .message-content bubble - not two stacked. The slash token
    // sits inline inside that bubble so display: block on .message-content
    // can't split the rendering across lines.
    expect(container.querySelectorAll('.message-content')).toHaveLength(1)
    const bubble = container.querySelector('.message-content')
    expect(bubble.querySelector('.slash-command')).not.toBeNull()
  })

  it('renders stdout block', () => {
    render(
      <UserMessageContent message="<local-command-stdout>output here</local-command-stdout>" />,
    )

    expect(screen.getByText('stdout')).toBeInTheDocument()
    expect(screen.getByText('output here')).toBeInTheDocument()
  })

  it('renders stderr block with warning styling', () => {
    render(<UserMessageContent message="<local-command-stderr>error here</local-command-stderr>" />)

    expect(screen.getByText('stderr')).toBeInTheDocument()
    expect(screen.getByText('error here')).toBeInTheDocument()
    expect(document.querySelector('.local-command-stderr')).toBeInTheDocument()
  })

  it('renders mixed text and command output as separate segments', () => {
    const msg = 'Run this\n<local-command-stdout>output</local-command-stdout>'
    render(<UserMessageContent message={msg} />)

    expect(screen.getByText(/Run this/)).toBeInTheDocument()
    expect(screen.getByText('stdout')).toBeInTheDocument()
    expect(screen.getByText('output')).toBeInTheDocument()
  })

  it('collapses stdout on click', async () => {
    const user = userEvent.setup()
    render(<UserMessageContent message="<local-command-stdout>output</local-command-stdout>" />)

    // Initially expanded
    expect(screen.getByText('output')).toBeInTheDocument()

    // Click header to collapse
    await user.click(screen.getByText('stdout'))
    expect(screen.queryByText('output')).not.toBeInTheDocument()

    // Click again to expand
    await user.click(screen.getByText('stdout'))
    expect(screen.getByText('output')).toBeInTheDocument()
  })

  it('collapses stderr on click', async () => {
    const user = userEvent.setup()
    render(<UserMessageContent message="<local-command-stderr>error</local-command-stderr>" />)

    // Initially expanded
    expect(screen.getByText('error')).toBeInTheDocument()

    // Click header to collapse
    await user.click(screen.getByText('stderr'))
    expect(screen.queryByText('error')).not.toBeInTheDocument()
  })

  it('renders structured Q/A response', () => {
    const msg = `<response:AskUserQuestion>
  <question header="Auth" text="Which auth method?">
    <answer>OAuth</answer>
  </question>
</response:AskUserQuestion>`
    render(<UserMessageContent message={msg} />)

    expect(screen.getByText('Response')).toBeInTheDocument()
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Which auth method?')).toBeInTheDocument()
    expect(screen.getByText('OAuth')).toBeInTheDocument()
  })

  it('renders multi-answer Q/A response', () => {
    const msg = `<response:AskUserQuestion>
  <question header="Features" text="Select features">
    <answer>Dark mode</answer>
    <answer>Notifications</answer>
  </question>
</response:AskUserQuestion>`
    render(<UserMessageContent message={msg} />)

    expect(screen.getByText('Dark mode')).toBeInTheDocument()
    expect(screen.getByText('Notifications')).toBeInTheDocument()
  })

  it('renders image attachment thumbnails below message', () => {
    const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
    render(<UserMessageContent message="See attached" attachments={attachments} />)

    expect(screen.getByText('See attached')).toBeInTheDocument()
    const img = screen.getByAltText('photo.png')
    expect(img).toHaveClass('message-attachment-thumb')
    expect(img.src).toContain('data:image/png;base64,')
  })

  it('renders non-image attachment with extension badge', () => {
    const attachments = [{ name: 'report.pdf', type: 'application/pdf', data: 'JVBERi0=' }]
    render(<UserMessageContent message="Here" attachments={attachments} />)

    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
  })

  it('renders no attachment row when attachments is null', () => {
    render(<UserMessageContent message="Plain" attachments={null} />)

    expect(screen.getByText('Plain')).toBeInTheDocument()
    expect(document.querySelector('.message-attachments')).not.toBeInTheDocument()
  })

  it('renders attachments with slash command', () => {
    const attachments = [{ name: 'image.jpg', type: 'image/jpeg', data: '/9j/4AAQ=' }]
    render(
      <UserMessageContent
        message="<command-name>/scope</command-name><command-args>src</command-args>"
        attachments={attachments}
      />,
    )

    expect(screen.getByText(/\/scope/)).toBeInTheDocument()
    expect(screen.getByAltText('image.jpg')).toBeInTheDocument()
  })

  it('renders a collapsed inline-replies placeholder', () => {
    const inlineReplies = [
      { quote: 'ctx window', from: 'assistant', response: 'how big?' },
      { quote: 'my text', from: 'user', response: 'a note' },
    ]
    render(<UserMessageContent message="see comments" inlineReplies={inlineReplies} />)

    expect(screen.getByText('Replied inline - 2 comments')).toBeInTheDocument()
    expect(screen.queryByText('how big?')).not.toBeInTheDocument()
  })

  it('expands the inline-replies placeholder to reveal quote/reply pairs', async () => {
    const user = userEvent.setup()
    const inlineReplies = [{ quote: 'ctx window', from: 'assistant', response: 'how big?' }]
    render(<UserMessageContent message="see" inlineReplies={inlineReplies} />)

    await user.click(screen.getByTestId('inline-replies-placeholder'))

    expect(screen.getByText('how big?')).toBeInTheDocument()
    expect(screen.getByText('ctx window')).toBeInTheDocument()
  })

  it('singularizes the inline-replies placeholder for a single comment', () => {
    render(
      <UserMessageContent
        message=""
        inlineReplies={[{ quote: 'q', from: 'user', response: 'r' }]}
      />,
    )

    expect(screen.getByText('Replied inline - 1 comment')).toBeInTheDocument()
  })

  it('renders no inline-replies placeholder when inlineReplies is null', () => {
    render(<UserMessageContent message="Plain" inlineReplies={null} />)

    expect(screen.queryByTestId('inline-replies-placeholder')).not.toBeInTheDocument()
  })

  describe('content-only sends (empty composer)', () => {
    it('renders no empty message box for an attachment-only send', () => {
      const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
      const { container } = render(<UserMessageContent message="" attachments={attachments} />)

      // Attachment chips present, but no message-content element at all.
      expect(screen.getByAltText('photo.png')).toBeInTheDocument()
      expect(container.querySelector('.message-content')).toBeNull()
      expect(container.querySelector('.message-content-with-commands')).toBeNull()
    })

    it('renders no empty message box for a reply-only send', () => {
      const inlineReplies = [{ quote: 'q', from: 'user', response: 'r' }]
      const { container } = render(<UserMessageContent message="" inlineReplies={inlineReplies} />)

      expect(screen.getByText('Replied inline - 1 comment')).toBeInTheDocument()
      expect(container.querySelector('.message-content')).toBeNull()
      expect(container.querySelector('.message-content-with-commands')).toBeNull()
    })

    it('suppresses the box for a whitespace-only message too', () => {
      const attachments = [{ name: 'a.pdf', type: 'application/pdf', data: 'JVBERi0=' }]
      const { container } = render(<UserMessageContent message="   " attachments={attachments} />)

      expect(screen.getByText('a.pdf')).toBeInTheDocument()
      expect(container.querySelector('.message-content')).toBeNull()
    })

    it('still renders the message box when text is present alongside attachments', () => {
      const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
      const { container } = render(<UserMessageContent message="Look" attachments={attachments} />)

      expect(screen.getByText('Look')).toHaveClass('message-content')
      expect(container.querySelector('.message-content')).not.toBeNull()
    })
  })

  describe('attachment zoom', () => {
    it('opens zoom overlay on image click', async () => {
      const user = userEvent.setup()
      const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
      render(<UserMessageContent message="See this" attachments={attachments} />)

      await user.click(screen.getByAltText('photo.png'))

      expect(document.querySelector('.attachment-zoom-overlay')).toBeInTheDocument()
      expect(screen.getByAltText('Attachment preview')).toBeInTheDocument()
    })

    it('closes zoom overlay on close button click', async () => {
      const user = userEvent.setup()
      const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
      render(<UserMessageContent message="See this" attachments={attachments} />)

      await user.click(screen.getByAltText('photo.png'))
      expect(document.querySelector('.attachment-zoom-overlay')).toBeInTheDocument()

      await user.click(screen.getByTitle('Close'))
      expect(document.querySelector('.attachment-zoom-overlay')).not.toBeInTheDocument()
    })

    it('closes zoom overlay on Escape key', async () => {
      const user = userEvent.setup()
      const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
      render(<UserMessageContent message="See this" attachments={attachments} />)

      await user.click(screen.getByAltText('photo.png'))
      expect(document.querySelector('.attachment-zoom-overlay')).toBeInTheDocument()

      await user.keyboard('{Escape}')
      expect(document.querySelector('.attachment-zoom-overlay')).not.toBeInTheDocument()
    })

    it('closes zoom overlay on backdrop click', async () => {
      const user = userEvent.setup()
      const attachments = [{ name: 'photo.png', type: 'image/png', data: 'iVBORw0KGgo=' }]
      render(<UserMessageContent message="See this" attachments={attachments} />)

      await user.click(screen.getByAltText('photo.png'))
      const overlay = document.querySelector('.attachment-zoom-overlay')
      expect(overlay).toBeInTheDocument()

      await user.click(overlay)
      expect(document.querySelector('.attachment-zoom-overlay')).not.toBeInTheDocument()
    })

    it('does not open zoom for non-image attachments', async () => {
      const user = userEvent.setup()
      const attachments = [{ name: 'report.pdf', type: 'application/pdf', data: 'JVBERi0=' }]
      render(<UserMessageContent message="Here" attachments={attachments} />)

      await user.click(screen.getByText('PDF'))
      expect(document.querySelector('.attachment-zoom-overlay')).not.toBeInTheDocument()
    })
  })

  describe('/tmp path highlighting', () => {
    it('highlights /tmp paths in plain text message', () => {
      mockSessionDir.current = '/host/sessions/abc'
      const { container } = render(<UserMessageContent message="copy files to /tmp/output" />)
      mockSessionDir.current = null

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('/tmp/output')
    })

    it('highlights bare /tmp in message', () => {
      mockSessionDir.current = '/host/sessions/abc'
      const { container } = render(<UserMessageContent message="check what is in /tmp please" />)
      mockSessionDir.current = null

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('/tmp')
    })

    it('does not highlight /tmp paths when sessionDir is null', () => {
      mockSessionDir.current = null
      const { container } = render(<UserMessageContent message="copy to /tmp/foo.log" />)

      expect(container.querySelector('.path-link')).toBeNull()
    })
  })

  describe('general path highlighting', () => {
    it('highlights resolved paths in message', () => {
      mockResolvedPaths.current = { 'src/app.js': '/abs/src/app.js' }
      const { container } = render(<UserMessageContent message="edit src/app.js please" />)
      mockResolvedPaths.current = {}

      const pathLink = container.querySelector('.path-link')
      expect(pathLink).not.toBeNull()
      expect(pathLink).toHaveTextContent('src/app.js')
    })

    it('does not highlight unresolved paths', () => {
      mockResolvedPaths.current = {}
      mockSessionDir.current = null
      const { container } = render(<UserMessageContent message="edit src/app.js please" />)

      expect(container.querySelector('.path-link')).toBeNull()
    })
  })
})
