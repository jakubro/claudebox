/** Tests for attachmentHelpers.js file reading and validation. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../constants/thresholds', () => ({
  MAX_FILE_SIZE: 10 * 1024 * 1024,
}))

import { readFileAsBase64, validateFile } from './attachmentHelpers'

describe('validateFile', () => {
  it('returns null for files under limit', () => {
    const file = { name: 'small.txt', size: 1024 }
    expect(validateFile(file)).toBeNull()
  })

  it('returns error string for files over 10MB', () => {
    const file = { name: 'big.bin', size: 11 * 1024 * 1024 }
    const error = validateFile(file)

    expect(error).toContain('big.bin')
    expect(error).toContain('10MB')
  })

  it('returns null for file exactly at limit', () => {
    const file = { name: 'exact.bin', size: 10 * 1024 * 1024 }
    expect(validateFile(file)).toBeNull()
  })
})

describe('readFileAsBase64', () => {
  let capturedReader

  beforeEach(() => {
    capturedReader = null
    vi.stubGlobal(
      'FileReader',
      class MockFileReader {
        constructor() {
          this.onload = null
          this.onerror = null
          this.result = null
          this.readAsDataURL = vi.fn()
          capturedReader = this
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves with base64 data from FileReader', async () => {
    const promise = readFileAsBase64({ name: 'test.txt' })

    capturedReader.result = 'data:text/plain;base64,aGVsbG8='
    capturedReader.onload()

    const result = await promise
    expect(result).toBe('aGVsbG8=')
  })

  it('rejects on FileReader error', async () => {
    const promise = readFileAsBase64({ name: 'test.txt' })
    const error = new Error('read failed')
    capturedReader.onerror(error)

    await expect(promise).rejects.toBe(error)
  })
})
