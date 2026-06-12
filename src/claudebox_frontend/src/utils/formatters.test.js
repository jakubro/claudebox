/** Tests for general-purpose formatting utilities. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  formatBlockTiming,
  formatCost,
  formatDuration,
  formatDurationClock,
  formatDurationCompact,
  formatFilePath,
  formatRelativeTime,
  formatTokens,
  formatTurns,
  formatUserMessageForCopy,
  getBasename,
  getFirstLine,
  stripMarkdown,
} from './formatters'

describe('formatDuration', () => {
  it('formats seconds only', () => {
    expect(formatDuration(5)).toBe('5s')
    expect(formatDuration(59)).toBe('59s')
  })

  it('formats minutes and seconds', () => {
    expect(formatDuration(60)).toBe('1m 0s')
    expect(formatDuration(90)).toBe('1m 30s')
    expect(formatDuration(125)).toBe('2m 5s')
  })

  it('formats hours, minutes, and seconds', () => {
    expect(formatDuration(3600)).toBe('1h 0m 0s')
    expect(formatDuration(3665)).toBe('1h 1m 5s')
    expect(formatDuration(7325)).toBe('2h 2m 5s')
  })

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0s')
  })

  it('handles negative values', () => {
    expect(formatDuration(-5)).toBe('0s')
  })

  it('floors fractional seconds', () => {
    expect(formatDuration(5.9)).toBe('5s')
  })
})

describe('formatBlockTiming', () => {
  it('formats duration and relative time', () => {
    expect(formatBlockTiming(2, 8)).toBe('2s · @ +8s')
  })

  it('formats duration only when relativeTime is null', () => {
    expect(formatBlockTiming(5, null)).toBe('5s')
  })

  it('formats relative time only when duration is null', () => {
    expect(formatBlockTiming(null, 3)).toBe('@ +3s')
  })

  it('returns empty string when both are null', () => {
    expect(formatBlockTiming(null, null)).toBe('')
  })

  it('formats larger values with full duration format', () => {
    expect(formatBlockTiming(90, 125)).toBe('1m 30s · @ +2m 5s')
  })

  it('handles zero values', () => {
    expect(formatBlockTiming(0, 0)).toBe('0s · @ +0s')
  })
})

describe('formatDurationCompact', () => {
  it('formats seconds under a minute', () => {
    expect(formatDurationCompact(0)).toBe('0s')
    expect(formatDurationCompact(1)).toBe('1s')
    expect(formatDurationCompact(59)).toBe('59s')
  })

  it('formats minutes without seconds', () => {
    expect(formatDurationCompact(60)).toBe('1m')
    expect(formatDurationCompact(90)).toBe('1m')
    expect(formatDurationCompact(3599)).toBe('59m')
  })

  it('formats hours with minutes', () => {
    expect(formatDurationCompact(3600)).toBe('1h 0m')
    expect(formatDurationCompact(5400)).toBe('1h 30m')
    expect(formatDurationCompact(86399)).toBe('23h 59m')
  })

  it('formats days with hours', () => {
    expect(formatDurationCompact(86400)).toBe('1d 0h')
    expect(formatDurationCompact(108000)).toBe('1d 6h')
    expect(formatDurationCompact(172800)).toBe('2d 0h')
  })
})

describe('formatDurationClock', () => {
  it('formats milliseconds as clock display', () => {
    expect(formatDurationClock(0)).toBe('0:00:00')
    expect(formatDurationClock(1000)).toBe('0:00:01')
    expect(formatDurationClock(60000)).toBe('0:01:00')
    expect(formatDurationClock(3600000)).toBe('1:00:00')
  })

  it('pads minutes and seconds with zeros', () => {
    expect(formatDurationClock(61000)).toBe('0:01:01')
    expect(formatDurationClock(3661000)).toBe('1:01:01')
  })

  it('handles multi-hour durations', () => {
    expect(formatDurationClock(36000000)).toBe('10:00:00')
  })
})

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "just now" for less than 1 minute', () => {
    const now = new Date('2024-01-15T12:00:00')
    vi.setSystemTime(now)

    expect(formatRelativeTime('2024-01-15T12:00:00')).toBe('just now')
    expect(formatRelativeTime('2024-01-15T11:59:30')).toBe('just now')
  })

  it('returns minutes ago', () => {
    vi.setSystemTime(new Date('2024-01-15T12:05:00'))
    expect(formatRelativeTime('2024-01-15T12:00:00')).toBe('5m ago')
  })

  it('returns hours ago', () => {
    vi.setSystemTime(new Date('2024-01-15T15:00:00'))
    expect(formatRelativeTime('2024-01-15T12:00:00')).toBe('3h ago')
  })

  it('returns days ago', () => {
    vi.setSystemTime(new Date('2024-01-17T12:00:00'))
    expect(formatRelativeTime('2024-01-15T12:00:00')).toBe('2d ago')
  })

  it('returns formatted date for more than 7 days', () => {
    vi.setSystemTime(new Date('2024-01-25T12:00:00'))
    const result = formatRelativeTime('2024-01-15T12:00:00')
    expect(result).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/)
  })
})

describe('formatCost', () => {
  it('formats cost with two decimal places', () => {
    expect(formatCost(1.5)).toBe('$1.50')
    expect(formatCost(0.05)).toBe('$0.05')
    expect(formatCost(10)).toBe('$10.00')
    expect(formatCost(999.99)).toBe('$999.99')
  })

  it('formats thousands with K suffix', () => {
    expect(formatCost(1000)).toBe('$1.00K')
    expect(formatCost(1234.56)).toBe('$1.23K')
    expect(formatCost(999999)).toBe('$1000.00K')
  })

  it('formats millions with M suffix', () => {
    expect(formatCost(1000000)).toBe('$1.00M')
    expect(formatCost(1234567.89)).toBe('$1.23M')
  })

  it('formats billions with B suffix', () => {
    expect(formatCost(1000000000)).toBe('$1.00B')
    expect(formatCost(1234567890)).toBe('$1.23B')
  })

  it('returns dash for null/undefined', () => {
    expect(formatCost(null)).toBe('-')
    expect(formatCost(undefined)).toBe('-')
  })

  it('handles zero', () => {
    expect(formatCost(0)).toBe('$0.00')
  })
})

describe('formatTurns', () => {
  it('formats turn count with label', () => {
    expect(formatTurns(1)).toBe('1 turns')
    expect(formatTurns(5)).toBe('5 turns')
    expect(formatTurns(100)).toBe('100 turns')
  })

  it('returns dash for null/undefined', () => {
    expect(formatTurns(null)).toBe('-')
    expect(formatTurns(undefined)).toBe('-')
  })

  it('handles zero', () => {
    expect(formatTurns(0)).toBe('0 turns')
  })
})

describe('formatTokens', () => {
  it('formats small token counts', () => {
    expect(formatTokens(100)).toBe('100')
    expect(formatTokens(999)).toBe('999')
  })

  it('formats thousands with K suffix', () => {
    expect(formatTokens(1000)).toBe('1K')
    expect(formatTokens(5500)).toBe('6K')
    expect(formatTokens(10000)).toBe('10K')
  })

  it('returns unknown for falsy values', () => {
    expect(formatTokens(0)).toBe('unknown')
    expect(formatTokens(null)).toBe('unknown')
    expect(formatTokens(undefined)).toBe('unknown')
  })
})

describe('getFirstLine', () => {
  it('returns first line of text', () => {
    expect(getFirstLine('first\nsecond\nthird')).toBe('first')
  })

  it('returns full text if single line', () => {
    expect(getFirstLine('single line')).toBe('single line')
  })

  it('truncates long lines with ellipsis', () => {
    const longLine = 'a'.repeat(60)
    expect(getFirstLine(longLine)).toBe(`${'a'.repeat(50)}...`)
  })

  it('respects custom maxLength', () => {
    expect(getFirstLine('hello world', 5)).toBe('hello...')
  })

  it('does not add ellipsis if exactly at max length', () => {
    expect(getFirstLine('hello', 5)).toBe('hello')
  })

  it('handles empty string', () => {
    expect(getFirstLine('')).toBe('')
  })
})

describe('formatUserMessageForCopy', () => {
  describe('plain text', () => {
    it('returns plain text unchanged', () => {
      expect(formatUserMessageForCopy('Hello world')).toBe('Hello world')
    })

    it('returns empty string for null', () => {
      expect(formatUserMessageForCopy(null)).toBe('')
    })

    it('returns empty string for undefined', () => {
      expect(formatUserMessageForCopy(undefined)).toBe('')
    })

    it('preserves unknown XML verbatim', () => {
      const message = '<todo>do this</todo>'
      expect(formatUserMessageForCopy(message)).toBe('<todo>do this</todo>')
    })
  })

  describe('slash commands', () => {
    it('formats command without args', () => {
      const message = '<command-name>help</command-name>'
      expect(formatUserMessageForCopy(message)).toBe('/help')
    })

    it('formats command with args', () => {
      const message = '<command-name>scope</command-name><command-args>add test</command-args>'
      expect(formatUserMessageForCopy(message)).toBe('/scope add test')
    })

    it('formats command with empty args', () => {
      const message = '<command-name>clear</command-name><command-args></command-args>'
      expect(formatUserMessageForCopy(message)).toBe('/clear')
    })

    it('handles command with leading slash already present', () => {
      const message =
        '<command-name>/scope</command-name><command-args>claudebox web ui</command-args>'
      expect(formatUserMessageForCopy(message)).toBe('/scope claudebox web ui')
    })

    it('formats command with angle brackets in args', () => {
      const message =
        '<command-name>/scope</command-name><command-args>claudebox <web></command-args>'
      expect(formatUserMessageForCopy(message)).toBe('/scope claudebox <web>')
    })
  })

  describe('local command output', () => {
    it('extracts stdout content', () => {
      const message = '<local-command-stdout>output here</local-command-stdout>'
      expect(formatUserMessageForCopy(message)).toBe('output here')
    })

    it('extracts stderr content', () => {
      const message = '<local-command-stderr>error here</local-command-stderr>'
      expect(formatUserMessageForCopy(message)).toBe('error here')
    })

    it('handles multiline stdout', () => {
      const message = '<local-command-stdout>line1\nline2\nline3</local-command-stdout>'
      expect(formatUserMessageForCopy(message)).toBe('line1\nline2\nline3')
    })
  })

  describe('structured AskUserQuestion response', () => {
    it('formats single question with single answer', () => {
      const message = `<response:AskUserQuestion>
  <question header="Auth" text="Which method?">
    <answer>OAuth</answer>
  </question>
</response:AskUserQuestion>`
      expect(formatUserMessageForCopy(message)).toBe('Which method?: OAuth')
    })

    it('formats single question with multiple answers', () => {
      const message = `<response:AskUserQuestion>
  <question header="Features" text="Which features?">
    <answer>Dark mode</answer>
    <answer>Notifications</answer>
  </question>
</response:AskUserQuestion>`
      expect(formatUserMessageForCopy(message)).toBe('Which features?: Dark mode, Notifications')
    })

    it('formats multiple questions', () => {
      const message = `<response:AskUserQuestion>
  <question header="Auth" text="Which auth method?">
    <answer>OAuth</answer>
  </question>
  <question header="Features" text="Which features?">
    <answer>Dark mode</answer>
    <answer>Notifications</answer>
  </question>
</response:AskUserQuestion>`
      expect(formatUserMessageForCopy(message)).toBe(
        'Which auth method?: OAuth\nWhich features?: Dark mode, Notifications',
      )
    })

    it('unescapes XML entities in answers', () => {
      const message = `<response:AskUserQuestion>
  <question header="Test" text="Question with &lt;special&gt; chars?">
    <answer>Answer with &amp; and &quot;quotes&quot;</answer>
  </question>
</response:AskUserQuestion>`
      expect(formatUserMessageForCopy(message)).toBe(
        'Question with <special> chars?: Answer with & and "quotes"',
      )
    })
  })

  describe('structured ExitPlanMode response', () => {
    it('formats ExitPlanMode approve response', () => {
      const message = `<response:ExitPlanMode>
  <question header="Plan" text="Review the plan above">
    <answer>Approve</answer>
  </question>
</response:ExitPlanMode>`
      expect(formatUserMessageForCopy(message)).toBe('Review the plan above: Approve')
    })

    it('formats ExitPlanMode reject with feedback', () => {
      const message = `<response:ExitPlanMode>
  <question header="Plan" text="Review the plan above">
    <answer>Other: Please reconsider step 3</answer>
  </question>
</response:ExitPlanMode>`
      expect(formatUserMessageForCopy(message)).toBe(
        'Review the plan above: Other: Please reconsider step 3',
      )
    })
  })

  describe('mixed content', () => {
    it('extracts content from inline local-command with leading text', () => {
      const message = 'Here is the output:\n<local-command-stdout>result</local-command-stdout>'
      expect(formatUserMessageForCopy(message)).toBe('Here is the output:\n\nresult')
    })

    it('extracts content from local-command with trailing text', () => {
      const message = '<local-command-stdout>result</local-command-stdout>\nDone!'
      expect(formatUserMessageForCopy(message)).toBe('result\n\nDone!')
    })

    it('handles multiple consecutive local-command blocks (full wrap)', () => {
      const message =
        '<local-command-stdout>out1</local-command-stdout><local-command-stderr>err1</local-command-stderr>'
      expect(formatUserMessageForCopy(message)).toBe('out1\n\nerr1')
    })

    it('preserves leading and trailing whitespace in plain messages', () => {
      expect(formatUserMessageForCopy('  hello world  ')).toBe('  hello world  ')
    })
  })
})

describe('stripMarkdown', () => {
  it('strips bold formatting', () => {
    expect(stripMarkdown('**bold text**')).toBe('bold text')
  })

  it('strips italic formatting', () => {
    expect(stripMarkdown('*italic text*')).toBe('italic text')
  })

  it('strips inline code', () => {
    expect(stripMarkdown('use `console.log`')).toBe('use console.log')
  })

  it('strips links and keeps text', () => {
    expect(stripMarkdown('[click here](https://example.com)')).toBe('click here')
  })

  it('strips headings', () => {
    expect(stripMarkdown('## Section Title')).toBe('Section Title')
  })

  it('returns empty string for falsy input', () => {
    expect(stripMarkdown('')).toBe('')
    expect(stripMarkdown(null)).toBe('')
    expect(stripMarkdown(undefined)).toBe('')
  })

  it('returns plain text unchanged', () => {
    expect(stripMarkdown('plain text')).toBe('plain text')
  })
})

describe('getBasename', () => {
  it('extracts filename from absolute path', () => {
    expect(getBasename('/home/user/project/file.js')).toBe('file.js')
  })

  it('extracts filename from relative path', () => {
    expect(getBasename('src/utils/helpers.ts')).toBe('helpers.ts')
  })

  it('returns filename if no directory', () => {
    expect(getBasename('file.txt')).toBe('file.txt')
  })

  it('handles trailing slash', () => {
    expect(getBasename('/some/path/')).toBe('')
  })

  it('returns falsy input as-is', () => {
    expect(getBasename('')).toBe('')
    expect(getBasename(null)).toBe(null)
    expect(getBasename(undefined)).toBe(undefined)
  })
})

describe('formatFilePath', () => {
  it('returns basename when collapsed', () => {
    expect(formatFilePath('/home/user/project/index.js', false)).toBe('index.js')
  })

  it('returns full path when expanded', () => {
    expect(formatFilePath('/home/user/project/index.js', true)).toBe('/home/user/project/index.js')
  })

  it('returns "file" for falsy path', () => {
    expect(formatFilePath('', false)).toBe('file')
    expect(formatFilePath(null, true)).toBe('file')
    expect(formatFilePath(undefined, false)).toBe('file')
  })

  it('handles single filename without directory', () => {
    expect(formatFilePath('app.tsx', false)).toBe('app.tsx')
    expect(formatFilePath('app.tsx', true)).toBe('app.tsx')
  })
})
