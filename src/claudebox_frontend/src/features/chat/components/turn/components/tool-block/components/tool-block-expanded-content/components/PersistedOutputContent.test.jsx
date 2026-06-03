/** Tests for PersistedOutputContent. */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PersistedOutputContent from './PersistedOutputContent'

// Mutable mock data for session context
let mockSessionData = { sessionId: 'sess-123' }

vi.mock('../../../../../../../../../context/SessionDataContext', () => ({
  useSessionData: () => mockSessionData,
}))

// Mutable mock for API calls
let mockGetToolOutput = vi.fn()

vi.mock('../../../../../../../../../api/sessions', () => ({
  getToolOutput: (...args) => mockGetToolOutput(...args),
  getToolOutputDownloadUrl: toolUseId => `/api/sessions/current/tool-output/${toolUseId}/download`,
}))

// Mock CopyButton to avoid clipboard complexity
vi.mock('../../../../../../../../../components/CopyButton', () => ({
  default: ({ title }) => <button data-testid="copy-btn" title={title} type="button" />,
}))

describe('PersistedOutputContent', () => {
  const defaultProps = {
    preview: 'preview content here',
    toolUseId: 'tool-456',
    fileSize: '2.5KB',
    previewSize: '500B',
  }

  beforeEach(() => {
    mockSessionData = { sessionId: 'sess-123' }
    mockGetToolOutput = vi.fn()
  })

  it('renders preview content', () => {
    render(<PersistedOutputContent {...defaultProps} />)

    expect(screen.getByText('preview content here')).toBeInTheDocument()
  })

  it('shows truncation info with preview and file sizes', () => {
    render(<PersistedOutputContent {...defaultProps} />)

    expect(screen.getByText('Truncated to 500B of 2.5KB')).toBeInTheDocument()
  })

  it('shows full output size when previewSize is not provided', () => {
    render(<PersistedOutputContent {...defaultProps} previewSize={undefined} />)

    expect(screen.getByText('Full output: 2.5KB')).toBeInTheDocument()
  })

  it('renders expand button when toolUseId and sessionId are present', () => {
    render(<PersistedOutputContent {...defaultProps} />)

    expect(screen.getByTitle('Show full output')).toBeInTheDocument()
  })

  it('renders download link', () => {
    render(<PersistedOutputContent {...defaultProps} />)

    const downloadLink = screen.getByTitle('Download full output')
    expect(downloadLink).toHaveAttribute(
      'href',
      '/api/sessions/current/tool-output/tool-456/download',
    )
  })

  it('fetches full content on expand click', async () => {
    mockGetToolOutput.mockResolvedValue({ content: 'full content here' })

    render(<PersistedOutputContent {...defaultProps} />)

    fireEvent.click(screen.getByTitle('Show full output'))

    await waitFor(() => {
      expect(mockGetToolOutput).toHaveBeenCalledWith('tool-456')
    })

    await waitFor(() => {
      expect(screen.getByText('full content here')).toBeInTheDocument()
    })
  })

  it('shows loading state while fetching', async () => {
    let resolvePromise
    mockGetToolOutput.mockReturnValue(
      new Promise(resolve => {
        resolvePromise = resolve
      }),
    )

    render(<PersistedOutputContent {...defaultProps} />)

    fireEvent.click(screen.getByTitle('Show full output'))

    // During loading the spinner class should be present
    await waitFor(() => {
      expect(document.querySelector('.spinner')).toBeInTheDocument()
    })

    // Resolve and wait for state updates to complete
    await act(async () => {
      resolvePromise({ content: 'done' })
    })
  })

  it('shows error message on fetch failure', async () => {
    mockGetToolOutput.mockRejectedValue(new Error('Network error'))

    render(<PersistedOutputContent {...defaultProps} />)

    fireEvent.click(screen.getByTitle('Show full output'))

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument()
    })
  })

  it('shows preview when API returns error status object', async () => {
    mockGetToolOutput.mockResolvedValue({ status: 'error', message: 'Not found' })

    render(<PersistedOutputContent {...defaultProps} />)

    fireEvent.click(screen.getByTitle('Show full output'))

    // API error status resolves without content property, so fullContent.content
    // is undefined and component falls back to showing preview
    await waitFor(() => {
      expect(screen.getByText('preview content here')).toBeInTheDocument()
    })
    expect(screen.queryByText('Not found')).not.toBeInTheDocument()
  })

  it('collapses back to preview on second click', async () => {
    mockGetToolOutput.mockResolvedValue({ content: 'full content here' })

    render(<PersistedOutputContent {...defaultProps} />)

    // Expand
    fireEvent.click(screen.getByTitle('Show full output'))

    await waitFor(() => {
      expect(screen.getByText('full content here')).toBeInTheDocument()
    })

    // Collapse
    fireEvent.click(screen.getByTitle('Show preview'))

    expect(screen.getByText('preview content here')).toBeInTheDocument()
    expect(screen.queryByText('full content here')).not.toBeInTheDocument()
  })

  it('does not refetch on re-expand after content is loaded', async () => {
    mockGetToolOutput.mockResolvedValue({ content: 'full content here' })

    render(<PersistedOutputContent {...defaultProps} />)

    // Expand
    fireEvent.click(screen.getByTitle('Show full output'))
    await waitFor(() => {
      expect(screen.getByText('full content here')).toBeInTheDocument()
    })

    // Collapse
    fireEvent.click(screen.getByTitle('Show preview'))

    // Re-expand
    fireEvent.click(screen.getByTitle('Show full output'))

    expect(mockGetToolOutput).toHaveBeenCalledTimes(1)
  })

  it('shows truncation notice when full content is truncated', async () => {
    mockGetToolOutput.mockResolvedValue({
      content: 'truncated content',
      truncated: true,
      total_size: 512000,
    })

    render(<PersistedOutputContent {...defaultProps} />)

    fireEvent.click(screen.getByTitle('Show full output'))

    await waitFor(() => {
      expect(screen.getByText('Truncated to 100KB of 500 KB')).toBeInTheDocument()
    })
  })

  it('renders nothing when preview is empty', () => {
    const { container } = render(<PersistedOutputContent toolUseId="tool-456" fileSize="1KB" />)

    // Should have the persisted-output wrapper but no inner content
    expect(container.querySelector('.tool-details-wrapper')).not.toBeInTheDocument()
  })
})
