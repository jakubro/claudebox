/** Tests for toolBlockState. */

import { describe, expect, it } from 'vitest'
import { hasExpandableContent, shouldStartCollapsed } from './toolBlockState'

describe('hasExpandableContent', () => {
  it('is expandable when a command payload is present and nothing else is', () => {
    expect(hasExpandableContent({ command: 'ls -la' })).toBe(true)
  })

  it('is not expandable when the command payload is absent alongside everything else', () => {
    expect(hasExpandableContent({ command: null })).toBe(false)
  })
})

describe('shouldStartCollapsed', () => {
  const bash = {
    toolName: 'Bash',
    singleLineDuplicate: false,
    hasNested: false,
    wasAnswered: false,
  }

  it('starts a Bash command that changes nothing collapsed, pending or done', () => {
    expect(shouldStartCollapsed({ ...bash, readOnlyCommand: true, isPending: true })).toBe(true)
    expect(shouldStartCollapsed({ ...bash, readOnlyCommand: true, isPending: false })).toBe(true)
  })

  it('keeps an unmarked Bash command with several lines of output expanded', () => {
    expect(shouldStartCollapsed({ ...bash, readOnlyCommand: false, isPending: false })).toBe(false)
  })

  it('keeps an unmarked Bash command expanded when its one line of output repeats its summary', () => {
    expect(shouldStartCollapsed({ ...bash, singleLineDuplicate: true, isPending: false })).toBe(
      false,
    )
  })

  it('still folds any other tool whose one line of output repeats its summary', () => {
    const mcp = { ...bash, toolName: 'mcp__notes__lookup', isPending: false }

    expect(shouldStartCollapsed({ ...mcp, singleLineDuplicate: false })).toBe(false)
    expect(shouldStartCollapsed({ ...mcp, singleLineDuplicate: true })).toBe(true)
  })
})
