/** Tests for toolBlockState. */

import { describe, expect, it } from 'vitest'
import { hasExpandableContent } from './toolBlockState'

describe('hasExpandableContent', () => {
  it('is expandable when a command payload is present and nothing else is', () => {
    expect(hasExpandableContent({ command: 'ls -la' })).toBe(true)
  })

  it('is not expandable when the command payload is absent alongside everything else', () => {
    expect(hasExpandableContent({ command: null })).toBe(false)
  })
})
