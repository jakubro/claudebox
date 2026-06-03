/** Tests for tool result formatter functions. */

import { describe, expect, it } from 'vitest'
import {
  buildToolHeader,
  extractSystemReminders,
  extractToolResult,
  generateJsonSummary,
  getSummaryText,
  getToolStatus,
  getToolTooltip,
  hasSpecializedFormatter,
  shouldCollapseByDefault,
} from './toolResultFormatters'

describe('generateJsonSummary', () => {
  describe('arrays', () => {
    it('returns item count for simple array', () => {
      const parsed = [1, 2, 3]
      expect(generateJsonSummary(parsed)).toBe('3 items')
    })

    it('returns singular for single item array', () => {
      const parsed = ['only one']
      expect(generateJsonSummary(parsed)).toBe('1 item')
    })

    it('extracts first text from text-type array', () => {
      const parsed = [{ type: 'text', text: 'Hello world' }]
      expect(generateJsonSummary(parsed)).toBe('Hello world')
    })

    it('returns full text (CSS handles truncation)', () => {
      const longText = 'A'.repeat(60)
      const parsed = [{ type: 'text', text: longText }]
      const result = generateJsonSummary(parsed)
      expect(result).toBe(longText) // Full text returned, CSS handles ellipsis
    })

    it('returns item count for empty array', () => {
      expect(generateJsonSummary([])).toBe('0 items')
    })
  })

  describe('objects', () => {
    it('shows first 3 keys for small objects', () => {
      const parsed = { a: 1, b: 2, c: 3 }
      expect(generateJsonSummary(parsed)).toBe('{a, b, c}')
    })

    it('shows ellipsis for objects with more than 3 keys', () => {
      const parsed = { a: 1, b: 2, c: 3, d: 4 }
      expect(generateJsonSummary(parsed)).toBe('{a, b, c, ...}')
    })

    it('shows empty braces for empty object', () => {
      expect(generateJsonSummary({})).toBe('{}')
    })

    it('shows single key without ellipsis', () => {
      const parsed = { only: 'one' }
      expect(generateJsonSummary(parsed)).toBe('{only}')
    })
  })
})

describe('buildToolHeader', () => {
  it('Bash: shows command', () => {
    expect(buildToolHeader('Bash', { command: 'ls -la' })).toBe('Bash(ls -la)')
  })

  it('Read: shows filename', () => {
    expect(buildToolHeader('Read', { file_path: '/home/user/file.txt' })).toBe('Read(file.txt)')
  })

  it('Edit: shows filename', () => {
    expect(buildToolHeader('Edit', { file_path: '/src/app.js' })).toBe('Edit(app.js)')
  })

  it('Write: shows filename', () => {
    expect(buildToolHeader('Write', { file_path: '/tmp/output.json' })).toBe('Write(output.json)')
  })

  it('Grep: shows pattern', () => {
    expect(buildToolHeader('Grep', { pattern: 'TODO' })).toBe('Grep(TODO)')
  })

  it('Glob: shows pattern', () => {
    expect(buildToolHeader('Glob', { pattern: '**/*.js' })).toBe('Glob(**/*.js)')
  })

  it('Task: shows description', () => {
    expect(buildToolHeader('Task', { description: 'Search codebase' })).toBe(
      'Task(Search codebase)',
    )
  })

  it('Task: falls back to prompt', () => {
    expect(buildToolHeader('Task', { prompt: 'Find files' })).toBe('Task(Find files)')
  })

  it('WebFetch: shows URL without protocol', () => {
    expect(buildToolHeader('WebFetch', { url: 'https://example.com/page' })).toBe(
      'WebFetch(example.com/page)',
    )
  })

  it('WebSearch: shows query', () => {
    expect(buildToolHeader('WebSearch', { query: 'vitest testing' })).toBe(
      'WebSearch(vitest testing)',
    )
  })

  it('Skill: shows skill name', () => {
    expect(buildToolHeader('Skill', { skill: 'commit' })).toBe('Skill(commit)')
  })

  it('AskUserQuestion: shows question count', () => {
    expect(buildToolHeader('AskUserQuestion', { questions: [{}, {}] })).toBe(
      'AskUserQuestion(2 questions)',
    )
  })

  it('AskUserQuestion: singular for one question', () => {
    expect(buildToolHeader('AskUserQuestion', { questions: [{}] })).toBe(
      'AskUserQuestion(1 question)',
    )
  })

  it('TaskOutput: shows task ID', () => {
    expect(buildToolHeader('TaskOutput', { task_id: 'b39dee5' })).toBe('TaskOutput(b39dee5)')
  })

  it('unknown tool: shows first string arg', () => {
    expect(buildToolHeader('CustomTool', { path: '/some/path' })).toBe('CustomTool(/some/path)')
  })

  it('unknown tool: shows name only when no string args', () => {
    expect(buildToolHeader('CustomTool', { count: 5 })).toBe('CustomTool')
  })

  it('unknown tool: shows name only for empty input', () => {
    expect(buildToolHeader('CustomTool', {})).toBe('CustomTool')
  })

  describe('isExpanded parameter', () => {
    it('Read: shows filename when collapsed (default)', () => {
      expect(buildToolHeader('Read', { file_path: '/home/user/src/file.txt' })).toBe(
        'Read(file.txt)',
      )
    })

    it('Read: shows full path when expanded', () => {
      expect(buildToolHeader('Read', { file_path: '/home/user/src/file.txt' }, true)).toBe(
        'Read(/home/user/src/file.txt)',
      )
    })

    it('Edit: shows filename when collapsed (default)', () => {
      expect(buildToolHeader('Edit', { file_path: '/src/app.js' })).toBe('Edit(app.js)')
    })

    it('Edit: shows full path when expanded', () => {
      expect(buildToolHeader('Edit', { file_path: '/src/app.js' }, true)).toBe('Edit(/src/app.js)')
    })

    it('Write: shows filename when collapsed (default)', () => {
      expect(buildToolHeader('Write', { file_path: '/tmp/output.json' })).toBe('Write(output.json)')
    })

    it('Write: shows full path when expanded', () => {
      expect(buildToolHeader('Write', { file_path: '/tmp/output.json' }, true)).toBe(
        'Write(/tmp/output.json)',
      )
    })

    it('Bash: ignores isExpanded (not a file tool)', () => {
      expect(buildToolHeader('Bash', { command: 'ls -la' }, true)).toBe('Bash(ls -la)')
    })
  })
})

describe('extractToolResult', () => {
  describe('error handling', () => {
    it('detects single-line error and sets details to null (no duplication)', () => {
      const content = '<tool_use_error>File not found: /missing.txt</tool_use_error>'
      const result = extractToolResult('Read', {}, content)

      expect(result.isError).toBe(true)
      expect(result.summary).toBe('File not found: /missing.txt')
      expect(result.details).toBeNull() // Single-line: no details block
    })

    it('detects multi-line error and includes details', () => {
      const multilineError = 'Error occurred:\nLine 1 failed\nLine 2 failed'
      const content = `<tool_use_error>${multilineError}</tool_use_error>`
      const result = extractToolResult('Bash', {}, content)

      expect(result.isError).toBe(true)
      expect(result.summary).toBe(multilineError)
      expect(result.details).toBe(multilineError) // Multi-line: show details block
    })

    it('returns full error message (CSS handles truncation via ellipsis)', () => {
      const longError = 'E'.repeat(150)
      const content = `<tool_use_error>${longError}</tool_use_error>`
      const result = extractToolResult('Bash', {}, content)

      expect(result.isError).toBe(true)
      // CSS text-overflow: ellipsis handles display truncation, not JS
      expect(result.summary).toBe(longError)
      expect(result.details).toBeNull() // Single line, even if long
    })
  })

  describe('Read formatter', () => {
    it('counts lines with line number format', () => {
      const content = '     1→first\n     2→second\n     3→third'
      const result = extractToolResult('Read', {}, content)

      expect(result.summary).toBe('Read 3 lines')
      expect(result.isError).toBe(false)
    })

    it('extracts warning message', () => {
      const content = 'Warning: File is empty'
      const result = extractToolResult('Read', {}, content)

      expect(result.summary).toBe('File is empty')
    })

    it('extracts system reminders from content', () => {
      const content = '     1→code\n<system-reminder>reminder1</system-reminder>\n     2→more code'
      const result = extractToolResult('Read', {}, content)

      expect(result.systemReminders).toEqual(['reminder1'])
      expect(result.details).not.toContain('system-reminder')
    })

    it('extracts multiple system reminders', () => {
      const content =
        '     1→code\n<system-reminder>first</system-reminder>\n<system-reminder>second</system-reminder>'
      const result = extractToolResult('Read', {}, content)

      expect(result.systemReminders).toEqual(['first', 'second'])
    })

    it('returns null systemReminders when none present', () => {
      const content = '     1→just code'
      const result = extractToolResult('Read', {}, content)

      expect(result.systemReminders).toBeNull()
    })
  })

  describe('Edit formatter', () => {
    it('generates diff summary for successful edit', () => {
      const input = { old_string: 'old line', new_string: 'new line\nadded line' }
      const content = 'The file has been updated'
      const result = extractToolResult('Edit', input, content)

      expect(result.isError).toBe(false)
      expect(result.summary).toMatch(/\+\d+/)
    })
  })

  describe('Write formatter', () => {
    it('returns line count and formatted content with input.content', () => {
      const input = { content: 'line1\nline2\nline3' }
      const result = extractToolResult('Write', input, 'The file has been created')

      expect(result.summary).toBe('Wrote 3 lines')
      expect(result.isError).toBe(false)
      expect(result.details).toContain('1→line1')
      expect(result.details).toContain('2→line2')
      expect(result.details).toContain('3→line3')
    })

    it('handles "created successfully" message variant', () => {
      const input = { content: 'import os\nprint("hello")' }
      const result = extractToolResult('Write', input, 'File created successfully at: /tmp/test.py')

      expect(result.summary).toBe('Wrote 2 lines')
      expect(result.isError).toBe(false)
      expect(result.details).toContain('1→import os')
    })

    it('falls back to default when no input.content', () => {
      const result = extractToolResult('Write', {}, 'The file has been created')

      expect(result.summary).toBe('The file has been created')
      expect(result.isError).toBe(false)
    })
  })

  describe('Bash formatter', () => {
    it('shows line count for multiline output', () => {
      const content = 'line1\nline2\nline3'
      const result = extractToolResult('Bash', {}, content)

      expect(result.summary).toBe('3 lines output')
    })

    it('shows preview for single line', () => {
      const content = 'single line output'
      const result = extractToolResult('Bash', {}, content)

      expect(result.summary).toBe('single line output')
    })

    it('returns details for single-line output (expandable)', () => {
      const content = 'single line output'
      const result = extractToolResult('Bash', {}, content)

      expect(result.details).toBe('single line output')
    })

    it('strips ANSI codes from output', () => {
      const content = '\u001b[32mline1\u001b[0m\nline2'
      const result = extractToolResult('Bash', {}, content)

      expect(result.details).toBe('line1\nline2')
    })

    it('extracts text from JSON array format', () => {
      const content = '[{"type": "text", "text": "actual output"}]'
      const result = extractToolResult('Bash', {}, content)

      expect(result.summary).toBe('actual output')
    })
  })

  describe('Grep formatter', () => {
    it('returns "No matches" when none found', () => {
      const result = extractToolResult('Grep', {}, 'No matches found')

      expect(result.summary).toBe('No matches')
      expect(result.details).toBeNull()
    })

    it('files_with_matches mode: counts files excluding header', () => {
      const content = 'Found 3 files\nfile1.js\nfile2.js\nfile3.js'
      const result = extractToolResult('Grep', {}, content)

      expect(result.summary).toBe('3 files')
    })

    it('files_with_matches mode: handles singular', () => {
      const content = 'Found 1 files\nfile1.js'
      const result = extractToolResult('Grep', {}, content)

      expect(result.summary).toBe('1 file')
    })

    it('content mode: counts only match lines (colon separator)', () => {
      // Real format: file:linenum:content for matches, file:linenum-content for context
      const content =
        'src/app.js:3-context line\nsrc/app.js:4-context line\nsrc/app.js:5:match line\nsrc/app.js:6-context line\n--\nsrc/utils.js:10:another match'
      const result = extractToolResult('Grep', { output_mode: 'content' }, content)

      expect(result.summary).toBe('2 matches')
    })

    it('content mode: handles singular match', () => {
      const content = 'src/app.js:5:single match'
      const result = extractToolResult('Grep', { output_mode: 'content' }, content)

      expect(result.summary).toBe('1 match')
    })

    it('content mode: counts single-file grep matches (no file prefix)', () => {
      // Single-file grep format: linenum:content for matches, linenum-content for context
      const content =
        '3-context line\n4-context line\n5:match line\n6-context line\n--\n10:another match'
      const result = extractToolResult('Grep', { output_mode: 'content' }, content)

      expect(result.summary).toBe('2 matches')
    })

    it('count mode: counts file lines excluding summary', () => {
      const content = 'file1.js:5\nfile2.js:10\nFound 15 total occurrences across 2 files.'
      const result = extractToolResult('Grep', { output_mode: 'count' }, content)

      expect(result.summary).toBe('2 files with matches')
    })

    it('count mode: handles singular file', () => {
      const content = 'file1.js:5\nFound 5 total occurrences across 1 files.'
      const result = extractToolResult('Grep', { output_mode: 'count' }, content)

      expect(result.summary).toBe('1 file with matches')
    })

    it('strips trailing pagination metadata from output', () => {
      const content =
        'Found 2 files\nfile1.js\nfile2.js\n\n[Showing results with pagination = limit: 40, offset: 0]'
      const result = extractToolResult('Grep', {}, content)

      expect(result.summary).toBe('2 files')
      expect(result.details).not.toContain('Showing results with pagination')
      expect(result.details).not.toMatch(/\n$/)
    })

    it('strips pagination metadata from content mode output', () => {
      const content =
        'src/app.js:5:match line\n\n[Showing results with pagination = limit: 30, offset: 0]'
      const result = extractToolResult('Grep', { output_mode: 'content' }, content)

      expect(result.summary).toBe('1 match')
      expect(result.details).not.toContain('Showing results with pagination')
    })

    it('does not strip pagination-like text from middle of content', () => {
      const content =
        'src/app.js:5:[Showing results with pagination = limit: 40, offset: 0]\nsrc/app.js:6:other match'
      const result = extractToolResult('Grep', { output_mode: 'content' }, content)

      expect(result.summary).toBe('2 matches')
      expect(result.details).toContain('Showing results with pagination')
    })
  })

  describe('Glob formatter', () => {
    it('returns "No files found" when none found', () => {
      const result = extractToolResult('Glob', {}, 'No files found matching pattern')

      expect(result.summary).toBe('No files found')
      expect(result.details).toBeNull()
    })

    it('counts matching files', () => {
      const content = 'src/a.js\nsrc/b.js\nsrc/c.js'
      const result = extractToolResult('Glob', {}, content)

      expect(result.summary).toBe('3 files')
    })
  })

  describe('Task formatter', () => {
    it('extracts first line from text response', () => {
      const content = 'Task completed successfully\nMore details here'
      const result = extractToolResult('Task', {}, content)

      expect(result.summary).toBe('Task completed successfully')
    })

    it('extracts text from JSON array format', () => {
      const content = '[{"type": "text", "text": "Found 5 files"}]'
      const result = extractToolResult('Task', {}, content)

      expect(result.summary).toBe('Found 5 files')
    })

    it('skips agentId entries in JSON array', () => {
      const content =
        '[{"type": "text", "text": "agentId: abc123"}, {"type": "text", "text": "Real result"}]'
      const result = extractToolResult('Task', {}, content)

      expect(result.summary).toBe('Real result')
    })

    it('extracts taskPrompt from input', () => {
      const input = { prompt: 'Search for all test files' }
      const result = extractToolResult('Task', input, 'Found 5 files')

      expect(result.taskPrompt).toBe('Search for all test files')
    })

    it('returns null taskPrompt when no prompt in input', () => {
      const result = extractToolResult('Task', {}, 'Done')

      expect(result.taskPrompt).toBeNull()
    })
  })

  describe('TodoWrite formatter', () => {
    it('returns "No changes" when no todos and no diff', () => {
      const result = extractToolResult('TodoWrite', {}, 'anything')

      expect(result.summary).toBe('No changes')
      expect(result.details).toBeNull()
      expect(result.todoData).toEqual([])
    })

    it('shows all todos as added (pending) when no todoDiff provided', () => {
      const input = {
        todos: [
          { content: 'Task 1', status: 'completed' },
          { content: 'Task 2', status: 'in_progress' },
          { content: 'Task 3', status: 'pending' },
          { content: 'Task 4', status: 'pending' },
        ],
      }
      const result = extractToolResult('TodoWrite', input, 'anything')

      // Fallback: shows all todos as added (pending)
      expect(result.summary).toBe('○4')
      expect(result.todoData).toEqual(input.todos)
    })

    it('shows diff counts when todoDiff provided', () => {
      const input = {
        todos: [
          { content: 'Task 1', status: 'completed' },
          { content: 'Task 2', status: 'in_progress' },
          { content: 'Task 3', status: 'pending' },
          { content: 'Task 4', status: 'pending' },
        ],
      }
      const todoDiff = {
        completed: [{ content: 'Task 1', status: 'completed' }],
        started: [{ content: 'Task 2', status: 'in_progress' }],
        added: [
          { content: 'Task 3', status: 'pending' },
          { content: 'Task 4', status: 'pending' },
        ],
      }
      const result = extractToolResult('TodoWrite', input, 'anything', { todoDiff })

      expect(result.summary).toBe('●1 ◐1 ○2')
      expect(result.todoData).toEqual(input.todos)
    })

    it('only shows relevant diff counts', () => {
      const input = {
        todos: [
          { content: 'Task 1', status: 'completed' },
          { content: 'Task 2', status: 'completed' },
        ],
      }
      const todoDiff = {
        completed: [
          { content: 'Task 1', status: 'completed' },
          { content: 'Task 2', status: 'completed' },
        ],
        started: [],
        added: [],
      }
      const result = extractToolResult('TodoWrite', input, 'anything', { todoDiff })

      expect(result.summary).toBe('●2')
    })

    it('handles in_progress only in diff', () => {
      const input = {
        todos: [{ content: 'Task', status: 'in_progress' }],
      }
      const todoDiff = {
        completed: [],
        started: [{ content: 'Task', status: 'in_progress' }],
        added: [],
      }
      const result = extractToolResult('TodoWrite', input, 'anything', { todoDiff })

      expect(result.summary).toBe('◐1')
    })
  })

  describe('persisted output handling', () => {
    it('processes preview like normal content with persistedOutput object', () => {
      const content = `<persisted-output>Output too large (50.7KB). Full output saved to: /path/to/file.txt

Preview (first 2KB):
Some preview content here
Multiple lines</persisted-output>`
      const result = extractToolResult('Bash', { command: 'ls -la' }, content)

      // Bash formatter: multiline → "N lines output"
      expect(result.summary).toBe('2 lines output')
      expect(result.isError).toBe(false)
      expect(result.persistedOutput).toEqual({ fileSize: '50.7KB', previewSize: '2KB' })
      expect(result.details).toBe('Some preview content here\nMultiple lines')
    })

    it('handles persisted output without preview', () => {
      const content = `<persisted-output>Output too large (10KB). Full output saved to: /tmp/output.log</persisted-output>`
      const result = extractToolResult('Bash', {}, content)

      // Bash formatter: empty content → 'Done', details is empty string
      expect(result.summary).toBe('Done')
      expect(result.persistedOutput).toEqual({ fileSize: '10KB', previewSize: null })
      expect(result.details).toBe('')
    })

    it('returns normal result when no persisted-output wrapper', () => {
      const content = 'Regular output content'
      const result = extractToolResult('Bash', { command: 'echo test' }, content)

      expect(result.persistedOutput).toBeUndefined()
      expect(result.summary).toBe('Regular output content')
    })
  })

  describe('Task tool - background tasks', () => {
    // Background task detection lives in ToolBlock.jsx via structured
    // tool_use_result data; extractToolResult handles plain-text fallbacks only.
    // These tests verify that async launch text falls through to normal handling.

    it('treats async launch message as regular text (structured data handled in ToolBlock)', () => {
      const content =
        'Async agent launched successfully.\nagentId: ac17519 (internal ID)\noutput_file: /tmp/tasks/ac17519.output'
      const result = extractToolResult('Task', { prompt: 'Research X' }, content)

      // Text is treated as normal task result - first line becomes summary
      expect(result.summary).toBe('Async agent launched successfully.')
      expect(result.isError).toBe(false)
      expect(result.taskPrompt).toBe('Research X')
      // backgroundTask is NOT extracted from text anymore
      expect(result.backgroundTask).toBeUndefined()
    })

    it('returns normal task result for completed tasks', () => {
      const content = 'Task completed successfully with results'
      const result = extractToolResult('Task', {}, content)

      expect(result.backgroundTask).toBeUndefined()
      expect(result.summary).toBe('Task completed successfully with results')
    })
  })

  describe('TaskOutput tool', () => {
    it('running task shows Running status', () => {
      const content = `<retrieval_status>not_ready</retrieval_status>
<task_id>b39dee5</task_id>
<task_type>local_bash</task_type>
<status>running</status>`
      const result = extractToolResult('TaskOutput', {}, content)

      expect(result.summary).toBe('Running')
      expect(result.isError).toBe(false)
      expect(result.isTaskOutputRunning).toBe(true)
    })

    it('completed task shows Completed status', () => {
      const content = `<retrieval_status>success</retrieval_status>
<task_id>abc123</task_id>
<task_type>agent</task_type>
<status>completed</status>`
      const result = extractToolResult('TaskOutput', {}, content)

      expect(result.summary).toBe('Completed')
      expect(result.isError).toBe(false)
      expect(result.isTaskOutputRunning).toBe(false)
    })

    it('completed task with output shows Completed, no details', () => {
      const content = `<retrieval_status>success</retrieval_status>
<task_id>abc123</task_id>
<status>completed</status>
<output>Some output here</output>`
      const result = extractToolResult('TaskOutput', {}, content)

      expect(result.summary).toBe('Completed')
      expect(result.details).toBeNull()
    })

    it('failed task shows Failed status', () => {
      const content = `<retrieval_status>failed</retrieval_status>
<task_id>xyz789</task_id>
<status>failed</status>`
      const result = extractToolResult('TaskOutput', {}, content)

      expect(result.summary).toBe('Failed')
      expect(result.isError).toBe(true)
    })

    it('timeout shows Timeout status', () => {
      const content = `<retrieval_status>timeout</retrieval_status>
<task_id>test123</task_id>
<status>running</status>`
      const result = extractToolResult('TaskOutput', {}, content)

      expect(result.summary).toBe('Timeout')
    })
  })

  describe('default formatter', () => {
    it('parses JSON and generates summary', () => {
      const content = '{"status": "ok", "count": 5}'
      const result = extractToolResult('UnknownTool', {}, content)

      expect(result.summary).toBe('{status, count}')
      expect(result.jsonData).toEqual({ status: 'ok', count: 5 })
    })

    it('shows preview for plain text', () => {
      const content = 'Some plain text output'
      const result = extractToolResult('UnknownTool', {}, content)

      expect(result.summary).toBe('Some plain text output')
    })

    it('returns first line for multiline text (CSS handles ellipsis)', () => {
      const content = 'first line\nsecond line'
      const result = extractToolResult('UnknownTool', {}, content)

      // CSS text-overflow: ellipsis handles truncation, not JS
      expect(result.summary).toBe('first line')
    })
  })
})

describe('getToolStatus', () => {
  it('returns "pending" when isPending is true', () => {
    expect(getToolStatus(true, false, false)).toBe('pending')
  })

  it('returns "pending" when isAwaitingAnswer is true', () => {
    expect(getToolStatus(false, true, false)).toBe('pending')
  })

  it('returns "error" when isError is true and not pending', () => {
    expect(getToolStatus(false, false, true)).toBe('error')
  })

  it('returns "completed" when none are true', () => {
    expect(getToolStatus(false, false, false)).toBe('completed')
  })

  it('prioritizes pending over error', () => {
    expect(getToolStatus(true, false, true)).toBe('pending')
  })

  it('prioritizes awaiting over error', () => {
    expect(getToolStatus(false, true, true)).toBe('pending')
  })
})

describe('getToolTooltip', () => {
  it('returns file_path for Read tool', () => {
    expect(getToolTooltip('Read', { file_path: '/path/to/file.js' })).toBe('/path/to/file.js')
  })

  it('returns file_path for Write tool', () => {
    expect(getToolTooltip('Write', { file_path: '/path/to/file.js' })).toBe('/path/to/file.js')
  })

  it('returns file_path for Edit tool', () => {
    expect(getToolTooltip('Edit', { file_path: '/path/to/file.js' })).toBe('/path/to/file.js')
  })

  it('returns file_path for Glob tool', () => {
    expect(getToolTooltip('Glob', { file_path: '/path/to/file.js' })).toBe('/path/to/file.js')
  })

  it('returns command for Bash tool', () => {
    expect(getToolTooltip('Bash', { command: 'npm test' })).toBe('npm test')
  })

  it('returns prompt for Task tool', () => {
    expect(getToolTooltip('Task', { prompt: 'Research this topic' })).toBe('Research this topic')
  })

  it('returns pattern for Grep tool', () => {
    expect(getToolTooltip('Grep', { pattern: 'foo.*bar' })).toBe('foo.*bar')
  })

  it('returns url for WebFetch tool', () => {
    expect(getToolTooltip('WebFetch', { url: 'https://example.com' })).toBe('https://example.com')
  })

  it('returns query for WebSearch tool', () => {
    expect(getToolTooltip('WebSearch', { query: 'search term' })).toBe('search term')
  })

  it('returns all questions newline-separated for AskUserQuestion', () => {
    const input = {
      questions: [{ question: 'First question?' }, { question: 'Second question?' }],
    }
    expect(getToolTooltip('AskUserQuestion', input)).toBe('First question?\nSecond question?')
  })

  it('returns null for empty questions in AskUserQuestion', () => {
    expect(getToolTooltip('AskUserQuestion', { questions: [] })).toBe(null)
  })

  it('returns first string param for unknown tools', () => {
    expect(getToolTooltip('Unknown', { key: 'value' })).toBe('value')
  })

  it('returns null for unknown tools with non-string first param', () => {
    expect(getToolTooltip('Unknown', { key: 123 })).toBe(null)
  })

  it('returns null for empty input', () => {
    expect(getToolTooltip('Read', {})).toBe(null)
  })

  it('returns null for null input', () => {
    expect(getToolTooltip('Read', null)).toBe(null)
  })
})

describe('getSummaryText', () => {
  describe('AskUserQuestion tool', () => {
    it('returns "Awaiting response..." when awaiting answer', () => {
      const result = getSummaryText('AskUserQuestion', false, true, false, 'ignored', false)
      expect(result).toBe('Awaiting response...')
    })

    it('returns "Answered" when wasAnswered is true', () => {
      const result = getSummaryText('AskUserQuestion', false, false, true, 'ignored', false)
      expect(result).toBe('Answered')
    })

    it('returns "Skipped" when wasSkipped is true', () => {
      const result = getSummaryText('AskUserQuestion', false, true, false, 'ignored', false, true)
      expect(result).toBe('Skipped')
    })

    it('returns summary when not awaiting and not answered', () => {
      const result = getSummaryText('AskUserQuestion', false, false, false, 'Some summary', false)
      expect(result).toBe('Some summary')
    })
  })

  describe('ExitPlanMode tool', () => {
    it('returns "Awaiting response..." when awaiting answer', () => {
      const result = getSummaryText('ExitPlanMode', false, true, false, 'ignored', false)
      expect(result).toBe('Awaiting response...')
    })

    it('returns "Answered" when wasAnswered with no answerLabel', () => {
      const result = getSummaryText('ExitPlanMode', false, false, true, 'ignored', false)
      expect(result).toBe('Answered')
    })

    it('returns answerLabel when wasAnswered with label', () => {
      const result = getSummaryText(
        'ExitPlanMode',
        false,
        false,
        true,
        'ignored',
        false,
        false,
        'Approved',
      )
      expect(result).toBe('Approved')
    })

    it('returns "Rejected" answerLabel', () => {
      const result = getSummaryText(
        'ExitPlanMode',
        false,
        false,
        true,
        'ignored',
        false,
        false,
        'Rejected',
      )
      expect(result).toBe('Rejected')
    })

    it('returns "Skipped" when wasSkipped is true', () => {
      const result = getSummaryText('ExitPlanMode', false, true, false, 'ignored', false, true)
      expect(result).toBe('Skipped')
    })
  })

  describe('other tools', () => {
    it('returns empty string when isPending', () => {
      const result = getSummaryText('Read', true, false, false, 'ignored', false)
      expect(result).toBe('')
    })

    it('returns summary when completed', () => {
      const result = getSummaryText('Edit', false, false, false, 'File updated', false)
      expect(result).toBe('File updated')
    })

    it('returns summary with error styling context when isError', () => {
      const result = getSummaryText('Bash', false, false, false, 'Command failed', true)
      expect(result).toBe('Command failed')
    })
  })
})

describe('shouldCollapseByDefault', () => {
  describe('interactive tools', () => {
    it('returns false for pending AskUserQuestion', () => {
      expect(shouldCollapseByDefault('AskUserQuestion', null, false, false, false)).toBe(false)
    })

    it('returns true for answered AskUserQuestion', () => {
      expect(shouldCollapseByDefault('AskUserQuestion', null, false, false, true)).toBe(true)
    })

    it('returns false for pending ExitPlanMode', () => {
      expect(shouldCollapseByDefault('ExitPlanMode', null, false, false, false)).toBe(false)
    })

    it('returns false for answered ExitPlanMode (plan stays viewable)', () => {
      expect(shouldCollapseByDefault('ExitPlanMode', null, false, false, true)).toBe(false)
    })
  })

  describe('tools that should collapse by default', () => {
    it('returns true when jsonData is present', () => {
      expect(shouldCollapseByDefault('Unknown', { foo: 'bar' }, false, false)).toBe(true)
    })

    it('returns true for Read tool', () => {
      expect(shouldCollapseByDefault('Read', null, false, false)).toBe(true)
    })

    it('returns true for Skill tool', () => {
      expect(shouldCollapseByDefault('Skill', null, false, false)).toBe(true)
    })

    it('returns true for WebSearch tool', () => {
      expect(shouldCollapseByDefault('WebSearch', null, false, false)).toBe(true)
    })

    it('returns true for WebFetch tool', () => {
      expect(shouldCollapseByDefault('WebFetch', null, false, false)).toBe(true)
    })

    it('returns true for TaskOutput tool', () => {
      expect(shouldCollapseByDefault('TaskOutput', null, false, false)).toBe(true)
    })

    it('returns true for completed Task with nested events', () => {
      expect(shouldCollapseByDefault('Task', null, true, false)).toBe(true)
    })

    it('returns false for pending Task with nested events', () => {
      expect(shouldCollapseByDefault('Task', null, true, true)).toBe(false)
    })

    it('returns false for completed Task without nested events', () => {
      // Task with no nested and not pending — no special collapse rule
      expect(shouldCollapseByDefault('Task', null, false, false)).toBe(false)
    })

    it('returns false for pending Task without nested events', () => {
      expect(shouldCollapseByDefault('Task', null, false, true)).toBe(false)
    })
  })

  describe('default behavior', () => {
    it('returns false for unknown tool without special conditions', () => {
      expect(shouldCollapseByDefault('Unknown', null, false, false)).toBe(false)
    })

    it('returns false for Edit tool', () => {
      expect(shouldCollapseByDefault('Edit', null, false, false)).toBe(false)
    })

    it('returns true for Grep tool', () => {
      expect(shouldCollapseByDefault('Grep', null, false, false)).toBe(true)
    })
  })
})

describe('hasSpecializedFormatter', () => {
  it('returns true for handled tools', () => {
    expect(hasSpecializedFormatter('Read')).toBe(true)
    expect(hasSpecializedFormatter('Edit')).toBe(true)
    expect(hasSpecializedFormatter('Write')).toBe(true)
    expect(hasSpecializedFormatter('Bash')).toBe(true)
    expect(hasSpecializedFormatter('Grep')).toBe(true)
    expect(hasSpecializedFormatter('Glob')).toBe(true)
    expect(hasSpecializedFormatter('Task')).toBe(true)
    expect(hasSpecializedFormatter('TodoWrite')).toBe(true)
  })

  it('returns false for unhandled tools', () => {
    expect(hasSpecializedFormatter('mcp__chroma__chroma_query_documents')).toBe(false)
    expect(hasSpecializedFormatter('mcp__jina__search_web')).toBe(false)
    expect(hasSpecializedFormatter('UnknownTool')).toBe(false)
  })
})

describe('extractSystemReminders', () => {
  it('strips edge newlines but preserves leading/trailing spaces after removing reminders', () => {
    const content = '\n<system-reminder>reminder</system-reminder>\n  indented code  '
    const result = extractSystemReminders(content)

    expect(result.content).toBe('  indented code  ')
    expect(result.content.startsWith('  ')).toBe(true)
    expect(result.content.endsWith('  ')).toBe(true)
  })

  it('does not strip leading spaces from content when reminder is at end', () => {
    const content = '  leading spaces<system-reminder>reminder</system-reminder>'
    const result = extractSystemReminders(content)

    expect(result.content).toBe('  leading spaces')
  })

  it('does not strip trailing spaces from content when reminder is at start', () => {
    const content = '<system-reminder>reminder</system-reminder>trailing spaces  '
    const result = extractSystemReminders(content)

    expect(result.content).toBe('trailing spaces  ')
  })

  it('strips surrounding newlines but not spaces', () => {
    const content = '\n\n<system-reminder>reminder</system-reminder>\n  spaced content  \n\n'
    const result = extractSystemReminders(content)

    expect(result.content).toBe('  spaced content  ')
  })
})
