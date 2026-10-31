/** Tests for turnContent - pure derivations for Turn (preview, time range, copy text). */

import { describe, expect, it } from 'vitest'
import { BlockType } from '../../../../../config/schema'
import { TurnRoutingMode } from '../../../../../utils/eventProcessing'
import {
  getAnswerText,
  getAssistantTextContent,
  getProgressLabel,
  getTurnPreview,
} from './turnContent'

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

describe('getAnswerText', () => {
  it('returns the last text block of a text, tool, text turn', () => {
    const blocks = [
      textBlock('Let me look.'),
      toolBlock(),
      textBlock('Final answer with **bold**.'),
    ]

    expect(getAnswerText(blocks)).toBe('Final answer with **bold**.')
  })

  it('strips system reminders from the answer', () => {
    const blocks = [textBlock('The answer.\n<system-reminder>internal</system-reminder>')]

    expect(getAnswerText(blocks)).toBe('The answer.')
  })

  it('skips a trailing block that held only a system reminder', () => {
    const blocks = [
      textBlock('The answer.'),
      textBlock('<system-reminder>internal</system-reminder>'),
    ]

    expect(getAnswerText(blocks)).toBe('The answer.')
  })

  it('returns an empty string for a turn without text', () => {
    expect(getAnswerText([toolBlock(), compactionBlock()])).toBe('')
  })

  it('equals the whole turn copy when the answer is the only text', () => {
    const blocks = [toolBlock(), textBlock('Only this.')]

    expect(getAnswerText(blocks)).toBe(getAssistantTextContent(blocks))
  })

  it('takes a runtime error shown as the last text', () => {
    const error = {
      type: BlockType.TEXT,
      event: { type: 'system', subtype: 'error', content: 'Failed to process: timed out' },
    }

    expect(getAnswerText([textBlock('Working on it.'), toolBlock(), error])).toBe(
      'Failed to process: timed out',
    )
  })
})

describe('getProgressLabel', () => {
  const call = (content, input = {}, extra = {}) => ({
    type: BlockType.TOOL,
    toolUse: { content, tool_use_id: `${content}-1`, tool_input: input, ...extra.toolUse },
    toolResult: extra.toolResult,
  })
  const read = call('Read', { file_path: '/work/notes.md' })
  const focused = blocks => getProgressLabel(blocks, TurnRoutingMode.FOCUSED)

  it('names the newest hidden call, finished or not', () => {
    expect(focused([read])).toBe('Reading notes.md')
    expect(focused([{ ...read, toolResult: { content: 'ok' } }])).toBe('Reading notes.md')
  })

  it('follows the newest of several hidden calls', () => {
    expect(focused([read, call('Skill', { skill: 'changelog' })])).toBe('Loading changelog skill')
  })

  it.each([
    ['text', textBlock('The notes repeat two sections.')],
    ['thinking', { type: BlockType.THINKING, event: { content: 'hm' } }],
    ['a call the view shows', call('Edit', { file_path: '/work/notes.md' })],
    [
      'a failed read',
      call('Read', { file_path: '/work/a.md' }, { toolResult: { is_error: true } }),
    ],
    ['a Task', call('Task', { description: 'Fix it' })],
    ['a hidden TaskList', call('TaskList')],
    ['a hidden resource read', call('ReadMcpResourceTool', { server: 's', uri: 's://a' })],
  ])('gives null when %s is newest', (_label, block) => {
    expect(focused([read, block])).toBeNull()
  })

  it('keeps the read named past a hidden tool-schema search and a needs-you call', () => {
    expect(focused([read, hiddenToolSearchBlock()])).toBe('Reading notes.md')
    expect(focused([read, call('mcp__claudebox__needs_user', { reason: 'Approve' })])).toBe(
      'Reading notes.md',
    )
  })

  it('counts a needs-you call that failed', () => {
    const failed = call('needs_user', {}, { toolResult: { is_error: true } })
    expect(focused([read, failed])).toBeNull()
  })

  it('gives null for a bookmarked read, which the view shows', () => {
    expect(getProgressLabel([read], TurnRoutingMode.FOCUSED, new Set(['tool-Read-1']))).toBeNull()
  })

  it.each([TurnRoutingMode.OFF, TurnRoutingMode.BASH_ONLY, TurnRoutingMode.ALL_TOOLS])(
    'gives null outside Focused (%s)',
    mode => {
      expect(getProgressLabel([read], mode)).toBeNull()
    },
  )

  it('gives null with no blocks', () => {
    expect(focused([])).toBeNull()
  })

  it("names a tool marked hidden by hand by the tool's own name", () => {
    const marked = call('mcp__jina__read_url', { url: 'https://example.com' })
    const isMarked = name => name === 'mcp__jina__read_url'
    expect(getProgressLabel([marked], TurnRoutingMode.FOCUSED, null, isMarked)).toBe(
      'Running read_url',
    )
    expect(focused([marked])).toBeNull()
  })
})
