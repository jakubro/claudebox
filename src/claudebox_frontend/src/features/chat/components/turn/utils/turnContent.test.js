/** Tests for turnContent - pure derivations for Turn (preview, time range, copy text). */

import { describe, expect, it } from 'vitest'
import { BlockType } from '../../../../../config/schema'
import { TurnRoutingMode } from '../../../../../utils/eventProcessing'
import { getTurnPreview } from './turnContent'

/** Make a TEXT block. */
function textBlock(content) {
  return { type: BlockType.TEXT, event: { content } }
}

function toolBlock() {
  return { type: BlockType.TOOL, event: {} }
}

/** Make a hidden (successful) ToolSearch tool block. */
function hiddenToolSearchBlock() {
  return {
    type: BlockType.TOOL,
    toolUse: { content: 'ToolSearch' },
    toolResult: { is_error: false },
  }
}

function compactionBlock() {
  return { type: BlockType.COMPACTION, event: {} }
}

/** Make a top-level (or nested, via `parentId`) Bash tool block. */
function bashToolBlock(content = 'Bash', parentId = null) {
  return {
    type: BlockType.TOOL,
    toolUse: { content, tool_use_id: 'b-1', parent_tool_use_id: parentId },
  }
}

describe('getTurnPreview', () => {
  it('returns the first line of ordinary prose, truncated at 60 characters', () => {
    const preview = getTurnPreview([textBlock('Hello! How can I help you today?')], null)
    expect(preview).toBe('Hello! How can I help you today?')
  })

  it('truncates a long first line at 60 characters with an ellipsis', () => {
    const long = 'x'.repeat(80)
    const preview = getTurnPreview([textBlock(long)], null)
    expect(preview).toBe(`${'x'.repeat(60)}...`)
  })

  it('falls back to the first source line when the reply is only a fenced code block', () => {
    const content = '```python\ndef main() -> None:\n    pass\n```'
    const preview = getTurnPreview([textBlock(content)], null)
    expect(preview).toBeTruthy()
    expect(preview).not.toBe('')
    expect(preview).toBe('def main() -> None:')
  })

  it('falls back to the first source line when the reply is only a raw-HTML table', () => {
    const content = '<table>\n<tr><td>a</td><td>b</td></tr>\n</table>'
    const preview = getTurnPreview([textBlock(content)], null)
    expect(preview).toBeTruthy()
    expect(preview).toBe('<table>')
  })

  it('falls back to the first source line when the reply is only an alt-less image', () => {
    // An image with alt text strips to that text; only alt-less images hit the fallback path.
    const content = '![](cat.png)'
    const preview = getTurnPreview([textBlock(content)], null)
    expect(preview).toBeTruthy()
    expect(preview).toBe('![](cat.png)')
  })

  it('uses the stripped alt text when the reply is an image with alt text', () => {
    const content = '![a cat sleeping](cat.png)'
    const preview = getTurnPreview([textBlock(content)], null)
    expect(preview).toBe('a cat sleeping')
  })

  it('truncates the raw-source fallback at 60 characters too', () => {
    const longLine = 'x'.repeat(80)
    const content = `\`\`\`\n${longLine}\n\`\`\``
    const preview = getTurnPreview([textBlock(content)], null)
    expect(preview).toBe(`${'x'.repeat(60)}...`)
  })

  it('falls through to the tool count when the text block strips and raw-falls-back to nothing', () => {
    const preview = getTurnPreview([textBlock('```\n\n```'), toolBlock(), toolBlock()], null)
    expect(preview).toBe('2 tools used')
  })

  it('reports a single tool without pluralizing', () => {
    const preview = getTurnPreview([toolBlock()], null)
    expect(preview).toBe('1 tool used')
  })

  it('excludes hidden ToolSearch calls from the tool count', () => {
    const preview = getTurnPreview([toolBlock(), hiddenToolSearchBlock()], null)
    expect(preview).toBe('1 tool used')
  })

  it('falls through past an all-hidden tool list to the next fallback', () => {
    const preview = getTurnPreview([hiddenToolSearchBlock()], 5)
    expect(preview).toBe('Worked for 5s')
  })

  it('reports compaction when no text or tool block exists', () => {
    const preview = getTurnPreview([compactionBlock()], null)
    expect(preview).toBe('Conversation compacted')
  })

  it('reports duration as the last-resort fallback', () => {
    const preview = getTurnPreview([], 5)
    expect(preview).toBe('Worked for 5s')
  })

  it('returns null when there is nothing to preview at all', () => {
    const preview = getTurnPreview([], null)
    expect(preview).toBeNull()
  })

  it('prefers the stripped text over the fallback chain even with tool blocks present', () => {
    const preview = getTurnPreview([textBlock('All done'), toolBlock()], null)
    expect(preview).toBe('All done')
  })
})

describe('getTurnPreview - hideShellCalls (terminal column routing)', () => {
  it('counts a top-level Bash call by default (flag omitted)', () => {
    const preview = getTurnPreview([bashToolBlock()], null)
    expect(preview).toBe('1 tool used')
  })

  it('excludes a top-level Bash call from the tool count when hideShellCalls is true', () => {
    const preview = getTurnPreview([toolBlock(), bashToolBlock()], null, true)
    expect(preview).toBe('1 tool used')
  })

  it('excludes a LangGraph snake_case bash call the same as Bash', () => {
    const preview = getTurnPreview([toolBlock(), bashToolBlock('bash')], null, true)
    expect(preview).toBe('1 tool used')
  })

  it('keeps a nested Bash call in the count even with hideShellCalls true', () => {
    const preview = getTurnPreview([bashToolBlock('Bash', 'subagent-X')], null, true)
    expect(preview).toBe('1 tool used')
  })

  it('falls through past an all-hidden turn (Bash + ToolSearch) when hideShellCalls is true', () => {
    const preview = getTurnPreview([bashToolBlock(), hiddenToolSearchBlock()], 5, true)
    expect(preview).toBe('Worked for 5s')
  })

  it('excludes a top-level Bash call from the tool count when the mode is BASH_ONLY', () => {
    const preview = getTurnPreview([toolBlock(), bashToolBlock()], null, TurnRoutingMode.BASH_ONLY)
    expect(preview).toBe('1 tool used')
  })

  it('counts a top-level Bash call when the mode is OFF', () => {
    const preview = getTurnPreview([toolBlock(), bashToolBlock()], null, TurnRoutingMode.OFF)
    expect(preview).toBe('2 tools used')
  })
})
