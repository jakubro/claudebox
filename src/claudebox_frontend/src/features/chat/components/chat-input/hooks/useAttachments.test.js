/** Tests for useAttachments - attachments stay with the session they were added in. */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import useAttachments from './useAttachments'

vi.mock('../../../../../utils/attachmentHelpers', () => ({
  validateFile: () => null,
  readFileAsBase64: async () => 'data',
}))

const NO_TEXTAREA = { current: null }

function renderFor(ownerSessionId) {
  return renderHook(props => useAttachments(props), {
    initialProps: { setError: vi.fn(), textareaRef: NO_TEXTAREA, ownerSessionId },
  })
}

function pasteEvent(name) {
  return {
    preventDefault: vi.fn(),
    clipboardData: { files: [new File(['x'], name, { type: 'image/png' })] },
  }
}

describe('useAttachments', () => {
  it('keeps an attachment with the session it was added in across a switch', async () => {
    const { result, rerender } = renderFor('A')
    await act(async () => {
      result.current.handlePaste(pasteEvent('in-a.png'))
    })
    expect(result.current.attachments.map(a => a.name)).toEqual(['in-a.png'])

    rerender({ setError: vi.fn(), textareaRef: NO_TEXTAREA, ownerSessionId: 'B' })
    expect(result.current.attachments).toEqual([])

    rerender({ setError: vi.fn(), textareaRef: NO_TEXTAREA, ownerSessionId: 'A' })
    expect(result.current.attachments.map(a => a.name)).toEqual(['in-a.png'])
  })

  it('files an attachment added while B opens under B', async () => {
    const { result, rerender } = renderFor('B')
    await act(async () => {
      result.current.handlePaste(pasteEvent('for-b.png'))
    })

    rerender({ setError: vi.fn(), textareaRef: NO_TEXTAREA, ownerSessionId: 'A' })
    expect(result.current.attachments).toEqual([])
    rerender({ setError: vi.fn(), textareaRef: NO_TEXTAREA, ownerSessionId: 'B' })
    expect(result.current.attachments.map(a => a.name)).toEqual(['for-b.png'])
  })
})
