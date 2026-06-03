/** Tests for AttachmentPreview component. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { validateFile } from '../../../../../utils/attachmentHelpers'
import AttachmentPreview from './AttachmentPreview'

describe('AttachmentPreview', () => {
  const imageAttachment = {
    id: 'att-1',
    name: 'photo.png',
    type: 'image/png',
    data: 'iVBORw0KGgo=',
    size: 1024,
  }

  const fileAttachment = {
    id: 'att-2',
    name: 'report.pdf',
    type: 'application/pdf',
    data: 'JVBERi0=',
    size: 2048,
  }

  it('renders nothing when attachments is empty', () => {
    const { container } = render(<AttachmentPreview attachments={[]} onRemove={() => {}} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when attachments is null', () => {
    const { container } = render(<AttachmentPreview attachments={null} onRemove={() => {}} />)

    expect(container.innerHTML).toBe('')
  })

  it('renders image attachment as thumbnail', () => {
    render(<AttachmentPreview attachments={[imageAttachment]} onRemove={() => {}} />)

    const img = screen.getByAltText('photo.png')
    expect(img).toBeInTheDocument()
    expect(img).toHaveClass('attachment-thumb')
    expect(img.src).toContain('data:image/png;base64,')
  })

  it('renders non-image attachment with extension badge', () => {
    render(<AttachmentPreview attachments={[fileAttachment]} onRemove={() => {}} />)

    expect(screen.getByText('PDF')).toBeInTheDocument()
    expect(screen.getByText('report.pdf')).toBeInTheDocument()
  })

  it('calls onRemove with attachment id when remove button clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<AttachmentPreview attachments={[imageAttachment]} onRemove={onRemove} />)

    await user.click(screen.getByTitle('Remove attachment'))

    expect(onRemove).toHaveBeenCalledWith('att-1')
  })

  it('renders multiple attachments', () => {
    render(
      <AttachmentPreview attachments={[imageAttachment, fileAttachment]} onRemove={() => {}} />,
    )

    expect(screen.getByAltText('photo.png')).toBeInTheDocument()
    expect(screen.getByText('PDF')).toBeInTheDocument()
  })

  it('renders FILE label for files without extension', () => {
    const noExt = { id: 'att-3', name: 'README', type: 'text/plain', data: 'abc', size: 100 }
    render(<AttachmentPreview attachments={[noExt]} onRemove={() => {}} />)

    expect(screen.getByText('FILE')).toBeInTheDocument()
  })
})

describe('validateFile', () => {
  it('returns null for files under 10MB', () => {
    const file = { name: 'small.txt', size: 1024 }

    expect(validateFile(file)).toBeNull()
  })

  it('returns error string for files over 10MB', () => {
    const file = { name: 'big.bin', size: 11 * 1024 * 1024 }

    const error = validateFile(file)
    expect(error).toContain('big.bin')
    expect(error).toContain('10MB')
  })
})
