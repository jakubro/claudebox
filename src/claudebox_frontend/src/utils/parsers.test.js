/** Tests for parser utilities. */

import { describe, expect, it } from 'vitest'
import {
  parseGrepLine,
  parseLocalCommandOutput,
  parsePersistedOutput,
  parseSlashCommand,
  parseStructuredQA,
  stripTaskNotifications,
} from './parsers'

describe('parseSlashCommand', () => {
  it('parses command with name only', () => {
    const result = parseSlashCommand('<command-name>/help</command-name>')
    expect(result).toEqual({ cmd: '/help', args: '' })
  })

  it('parses command with name and args', () => {
    const result = parseSlashCommand(
      '<command-name>/commit</command-name><command-args>-m "fix bug"</command-args>',
    )
    expect(result).toEqual({ cmd: '/commit', args: '-m "fix bug"' })
  })

  it('parses command with whitespace between tags', () => {
    const result = parseSlashCommand(
      '<command-name>/test</command-name>  <command-args>--watch</command-args>',
    )
    expect(result).toEqual({ cmd: '/test', args: '--watch' })
  })

  it('trims whitespace from args', () => {
    const result = parseSlashCommand(
      '<command-name>/run</command-name><command-args>  spaced args  </command-args>',
    )
    expect(result).toEqual({ cmd: '/run', args: 'spaced args' })
  })

  it('handles empty args tag', () => {
    const result = parseSlashCommand(
      '<command-name>/status</command-name><command-args></command-args>',
    )
    expect(result).toEqual({ cmd: '/status', args: '' })
  })

  it('returns null for non-command content', () => {
    expect(parseSlashCommand('hello world')).toBeNull()
    expect(parseSlashCommand('/help')).toBeNull()
    expect(parseSlashCommand('')).toBeNull()
  })

  it('returns null for malformed tags', () => {
    expect(parseSlashCommand('<command-name>/test')).toBeNull()
    expect(parseSlashCommand('/test</command-name>')).toBeNull()
    expect(parseSlashCommand('<command>/test</command>')).toBeNull()
  })

  it('handles command embedded in other content', () => {
    const result = parseSlashCommand('prefix <command-name>/cmd</command-name> suffix')
    expect(result).toEqual({ cmd: '/cmd', args: '' })
  })

  it('captures args containing angle brackets', () => {
    const result = parseSlashCommand(
      '<command-name>/scope</command-name><command-args>claudebox <web></command-args>',
    )
    expect(result).toEqual({ cmd: '/scope', args: 'claudebox <web>' })
  })

  it('captures args with multiple angle brackets', () => {
    const result = parseSlashCommand(
      '<command-name>/test</command-name><command-args><foo> and <bar></command-args>',
    )
    expect(result).toEqual({ cmd: '/test', args: '<foo> and <bar>' })
  })
})

describe('parseLocalCommandOutput', () => {
  it('returns single text segment for plain message', () => {
    const result = parseLocalCommandOutput('Hello world')

    expect(result).toEqual([{ type: 'text', content: 'Hello world' }])
  })

  it('parses single stdout block', () => {
    const result = parseLocalCommandOutput(
      '<local-command-stdout>output here</local-command-stdout>',
    )

    expect(result).toEqual([{ type: 'stdout', content: 'output here' }])
  })

  it('parses single stderr block', () => {
    const result = parseLocalCommandOutput(
      '<local-command-stderr>error here</local-command-stderr>',
    )

    expect(result).toEqual([{ type: 'stderr', content: 'error here' }])
  })

  it('parses stdout with surrounding text into segments', () => {
    const msg = 'Run this\n<local-command-stdout>output</local-command-stdout>'
    const result = parseLocalCommandOutput(msg)

    expect(result).toEqual([
      { type: 'text', content: 'Run this' },
      { type: 'stdout', content: 'output' },
    ])
  })

  it('parses stderr with surrounding text into segments', () => {
    const msg = 'Error occurred\n<local-command-stderr>failed</local-command-stderr>'
    const result = parseLocalCommandOutput(msg)

    expect(result).toEqual([
      { type: 'text', content: 'Error occurred' },
      { type: 'stderr', content: 'failed' },
    ])
  })

  it('parses mixed stdout and stderr', () => {
    const msg =
      '<local-command-stdout>line1</local-command-stdout>\n<local-command-stderr>error</local-command-stderr>'
    const result = parseLocalCommandOutput(msg)

    expect(result).toEqual([
      { type: 'stdout', content: 'line1' },
      { type: 'stderr', content: 'error' },
    ])
  })

  it('preserves multiline content', () => {
    const content = 'line1\nline2\nline3'
    const result = parseLocalCommandOutput(
      `<local-command-stdout>${content}</local-command-stdout>`,
    )

    expect(result).toEqual([{ type: 'stdout', content }])
  })

  it('handles empty message', () => {
    expect(parseLocalCommandOutput('')).toEqual([])
    expect(parseLocalCommandOutput(null)).toEqual([])
    expect(parseLocalCommandOutput(undefined)).toEqual([])
  })

  it('handles empty tags', () => {
    const result = parseLocalCommandOutput('<local-command-stdout></local-command-stdout>')

    expect(result).toEqual([
      { type: 'text', content: '<local-command-stdout></local-command-stdout>' },
    ])
  })

  it('parses text before and after local-command into segments', () => {
    const msg = 'Before\n<local-command-stdout>middle</local-command-stdout>\nAfter'
    const result = parseLocalCommandOutput(msg)

    expect(result).toEqual([
      { type: 'text', content: 'Before' },
      { type: 'stdout', content: 'middle' },
      { type: 'text', content: 'After' },
    ])
  })

  it('parses structured Q/A format', () => {
    const msg = `<response:AskUserQuestion>
  <question header="Auth" text="Which auth method?">
    <answer>OAuth</answer>
  </question>
</response:AskUserQuestion>`
    const result = parseLocalCommandOutput(msg)

    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('qa')
    expect(result[0].questions).toEqual([
      { header: 'Auth', text: 'Which auth method?', answers: ['OAuth'] },
    ])
  })

  it('parses multi-answer Q/A format', () => {
    const msg = `<response:AskUserQuestion>
  <question header="Features" text="Which features?">
    <answer>Dark mode</answer>
    <answer>Notifications</answer>
  </question>
</response:AskUserQuestion>`
    const result = parseLocalCommandOutput(msg)

    expect(result[0].questions[0].answers).toEqual(['Dark mode', 'Notifications'])
  })

  it('unescapes XML entities in Q/A', () => {
    const msg = `<response:AskUserQuestion>
  <question header="Test &amp; Demo" text="Use &lt;script&gt;?">
    <answer>Yes &quot;quoted&quot;</answer>
  </question>
</response:AskUserQuestion>`
    const result = parseLocalCommandOutput(msg)

    expect(result[0].questions[0].header).toBe('Test & Demo')
    expect(result[0].questions[0].text).toBe('Use <script>?')
    expect(result[0].questions[0].answers[0]).toBe('Yes "quoted"')
  })

  it('falls back to text segment if Q/A parsing fails', () => {
    const msg = '<response:AskUserQuestion>invalid content</response:AskUserQuestion>'
    const result = parseLocalCommandOutput(msg)

    expect(result).toEqual([{ type: 'text', content: msg }])
  })

  it('preserves leading and trailing whitespace in plain messages', () => {
    const result = parseLocalCommandOutput('  hello world  ')

    expect(result).toEqual([{ type: 'text', content: '  hello world  ' }])
  })

  it('preserves internal newlines in plain messages', () => {
    const result = parseLocalCommandOutput('line1\n\nline2')

    expect(result).toEqual([{ type: 'text', content: 'line1\n\nline2' }])
  })
})

describe('parseGrepLine', () => {
  it('returns separator for "--"', () => {
    expect(parseGrepLine('--')).toEqual({ type: 'separator' })
  })

  it('parses file:linenum:content format (match line)', () => {
    const result = parseGrepLine('src/app.js:42:const x = 1')
    expect(result).toEqual({
      type: 'result',
      isMatch: true,
      file: 'src/app.js',
      sep1: ':',
      lineNum: '42',
      sep2: ':',
      content: 'const x = 1',
    })
  })

  it('parses file-linenum-content format (context line)', () => {
    const result = parseGrepLine('src/app.js-40-// comment')
    expect(result).toEqual({
      type: 'result',
      isMatch: false,
      file: 'src/app.js',
      sep1: '-',
      lineNum: '40',
      sep2: '-',
      content: '// comment',
    })
  })

  it('parses linenum:content format without file (single file search)', () => {
    const result = parseGrepLine('10:hello world')
    expect(result).toEqual({
      type: 'result',
      isMatch: true,
      file: null,
      sep1: '',
      lineNum: '10',
      sep2: ':',
      content: 'hello world',
    })
  })

  it('parses linenum-content context line without file', () => {
    const result = parseGrepLine('8-context line')
    expect(result).toEqual({
      type: 'result',
      isMatch: false,
      file: null,
      sep1: '',
      lineNum: '8',
      sep2: '-',
      content: 'context line',
    })
  })

  it('detects file path lines', () => {
    expect(parseGrepLine('src/utils/helpers.js')).toEqual({
      type: 'file',
      path: 'src/utils/helpers.js',
    })
  })

  it('returns plain for unrecognized lines', () => {
    expect(parseGrepLine('   indented text')).toEqual({
      type: 'plain',
      content: '   indented text',
    })
  })

  it('trims trailing whitespace and carriage returns', () => {
    const result = parseGrepLine('5:content\r')
    expect(result.content).toBe('content')
  })

  describe('files_with_matches mode', () => {
    it('returns file type for file paths', () => {
      expect(parseGrepLine('src/index.ts', 'files_with_matches')).toEqual({
        type: 'file',
        path: 'src/index.ts',
      })
    })

    it('returns plain for summary line', () => {
      expect(parseGrepLine('Found 3 files', 'files_with_matches')).toEqual({
        type: 'plain',
        content: 'Found 3 files',
      })
    })

    it('returns plain for singular file summary', () => {
      expect(parseGrepLine('Found 1 file', 'files_with_matches')).toEqual({
        type: 'plain',
        content: 'Found 1 file',
      })
    })

    it('returns plain for whitespace-only lines', () => {
      expect(parseGrepLine('  ', 'files_with_matches')).toEqual({
        type: 'plain',
        content: '',
      })
    })
  })
})

describe('parsePersistedOutput', () => {
  it('returns null when no persisted-output tag is present', () => {
    expect(parsePersistedOutput('regular output')).toBeNull()
  })

  it('parses persisted output with file info and preview', () => {
    const content = `<persisted-output>
Output too large (50.7KB). Full output saved to: /tmp/output.txt

Preview (first 2KB):
some preview content here
</persisted-output>`

    const result = parsePersistedOutput(content)
    expect(result).toEqual({
      isPersisted: true,
      filePath: '/tmp/output.txt',
      fileSize: '50.7KB',
      previewSize: '2KB',
      preview: 'some preview content here',
      originalContent: expect.any(String),
    })
  })

  it('handles persisted output without preview', () => {
    const content = `<persisted-output>
Output too large (10KB). Full output saved to: /tmp/data.log
</persisted-output>`

    const result = parsePersistedOutput(content)
    expect(result.isPersisted).toBe(true)
    expect(result.filePath).toBe('/tmp/data.log')
    expect(result.fileSize).toBe('10KB')
    expect(result.preview).toBeNull()
    expect(result.previewSize).toBeNull()
  })

  it('handles persisted output without file info', () => {
    const content = `<persisted-output>
Some other persisted content
</persisted-output>`

    const result = parsePersistedOutput(content)
    expect(result.isPersisted).toBe(true)
    expect(result.filePath).toBeNull()
    expect(result.fileSize).toBeNull()
  })
})

describe('parseStructuredQA', () => {
  it('parses single question with single answer', () => {
    const content = `<question header="Auth" text="Which method?">
  <answer>OAuth</answer>
</question>`
    const result = parseStructuredQA(content)
    expect(result).toEqual([{ header: 'Auth', text: 'Which method?', answers: ['OAuth'] }])
  })

  it('parses single question with multiple answers', () => {
    const content = `<question header="Features" text="Which features?">
  <answer>Dark mode</answer>
  <answer>Notifications</answer>
</question>`
    const result = parseStructuredQA(content)
    expect(result[0].answers).toEqual(['Dark mode', 'Notifications'])
  })

  it('parses multiple questions', () => {
    const content = `<question header="Q1" text="First?">
  <answer>A1</answer>
</question>
<question header="Q2" text="Second?">
  <answer>A2</answer>
</question>`
    const result = parseStructuredQA(content)
    expect(result).toHaveLength(2)
    expect(result[0].header).toBe('Q1')
    expect(result[1].header).toBe('Q2')
  })

  it('unescapes XML entities in header, text, and answers', () => {
    const content = `<question header="Test &amp; Demo" text="Use &lt;tag&gt;?">
  <answer>Yes &quot;quoted&quot;</answer>
</question>`
    const result = parseStructuredQA(content)
    expect(result[0].header).toBe('Test & Demo')
    expect(result[0].text).toBe('Use <tag>?')
    expect(result[0].answers[0]).toBe('Yes "quoted"')
  })

  it('returns null for content without valid question tags', () => {
    expect(parseStructuredQA('plain text')).toBeNull()
    expect(parseStructuredQA('')).toBeNull()
  })

  it('skips questions with no answers', () => {
    const content = `<question header="Empty" text="No answers?">
</question>`
    expect(parseStructuredQA(content)).toBeNull()
  })
})

describe('parseStructuredQA with ExitPlanMode response', () => {
  it('parses ExitPlanMode response when wrapper is stripped', () => {
    const content = `<question header="Plan" text="Review the plan above">
  <answer>Approve</answer>
</question>`
    const result = parseStructuredQA(content)
    expect(result).toEqual([
      { header: 'Plan', text: 'Review the plan above', answers: ['Approve'] },
    ])
  })
})

describe('stripTaskNotifications', () => {
  it('removes task-notification tags and content', () => {
    const msg = 'Hello<task-notification task-id="123">notify</task-notification> World'
    expect(stripTaskNotifications(msg)).toBe('Hello World')
  })

  it('removes agent-notification tags and content', () => {
    const msg = 'Start<agent-notification agent-id="a1">update</agent-notification> End'
    expect(stripTaskNotifications(msg)).toBe('Start End')
  })

  it('removes multiple notification tags', () => {
    const msg =
      '<task-notification task-id="1">x</task-notification>Content<agent-notification agent-id="2">y</agent-notification>'
    expect(stripTaskNotifications(msg)).toBe('Content')
  })

  it('returns original message when no notifications present', () => {
    const msg = 'no notifications here'
    expect(stripTaskNotifications(msg)).toBe('no notifications here')
  })

  it('returns falsy input as-is', () => {
    expect(stripTaskNotifications('')).toBe('')
    expect(stripTaskNotifications(null)).toBe(null)
    expect(stripTaskNotifications(undefined)).toBe(undefined)
  })

  it('handles multiline notification content', () => {
    const msg = 'before<task-notification task-id="1">line1\nline2</task-notification>after'
    expect(stripTaskNotifications(msg)).toBe('beforeafter')
  })

  it('preserves leading spaces after stripping notifications', () => {
    const msg = '  indented<task-notification task-id="1">x</task-notification>'
    expect(stripTaskNotifications(msg)).toBe('  indented')
  })

  it('preserves trailing spaces after stripping notifications', () => {
    const msg = '<task-notification task-id="1">x</task-notification>content  '
    expect(stripTaskNotifications(msg)).toBe('content  ')
  })

  it('strips surrounding newlines but not spaces after removal', () => {
    const msg = '\n<task-notification task-id="1">x</task-notification>\n  spaced  \n'
    expect(stripTaskNotifications(msg)).toBe('  spaced  ')
  })
})
