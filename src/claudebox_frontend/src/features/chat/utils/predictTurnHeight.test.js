/** Tests for predictTurnHeight pure function. */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AVG_CHAR_WIDTH_PX,
  LINE_HEIGHT_PX,
  PX_PER_ATTACHMENT_ROW,
  PX_PER_BASH_TOOL_BLOCK,
  PX_PER_THINKING_BLOCK,
  PX_PER_TOOL_BLOCK,
  TURN_BASE_HEIGHT_PX,
  TURN_HORIZONTAL_PADDING_PX,
  TURN_MIN_PREDICTED_HEIGHT_PX,
} from '../../../config/dimensions'
import { isLookupsGroupingEnabled } from '../../../config/features'
import { predictTurnHeight } from './predictTurnHeight'

vi.mock('../../../config/features', () => ({
  isLookupsGroupingEnabled: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(isLookupsGroupingEnabled).mockReturnValue(false)
})

const EFFECTIVE_WIDTH = 800 - TURN_HORIZONTAL_PADDING_PX

describe('predictTurnHeight', () => {
  it('returns MIN for a null turn', () => {
    expect(predictTurnHeight(null, EFFECTIVE_WIDTH)).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)
  })

  it('returns at least MIN for an empty turn', () => {
    const turn = { turn_id: 't', events: [], userMessage: '', attachments: null }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)
  })

  it('scales with assistant text length and column width', () => {
    const charsPerLine = Math.floor(EFFECTIVE_WIDTH / AVG_CHAR_WIDTH_PX)
    const turn = {
      turn_id: 't',
      events: [{ type: 'assistant', subtype: 'text', content: 'x'.repeat(charsPerLine * 5) }],
      userMessage: '',
      attachments: null,
    }
    const wide = predictTurnHeight(turn, EFFECTIVE_WIDTH)
    const narrow = predictTurnHeight(turn, EFFECTIVE_WIDTH / 2)
    // Narrower column -> more wrap lines -> larger predicted height.
    expect(narrow).toBeGreaterThan(wide)
    expect(wide).toBe(TURN_BASE_HEIGHT_PX + 5 * LINE_HEIGHT_PX)
  })

  it('adds fixed pixels per tool_use event', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'Edit' },
        { type: 'assistant', subtype: 'tool_use', content: 'Write' },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + 2 * PX_PER_TOOL_BLOCK),
    )
  })

  it('prices a Bash tool_use higher than a plain tool block - its own Command + Result chrome', () => {
    const turn = {
      turn_id: 't',
      events: [{ type: 'assistant', subtype: 'tool_use', content: 'Bash' }],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_BASH_TOOL_BLOCK),
    )
  })

  it('prices a LangGraph snake_case bash the same as Bash', () => {
    const turn = {
      turn_id: 't',
      events: [{ type: 'assistant', subtype: 'tool_use', content: 'bash' }],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_BASH_TOOL_BLOCK),
    )
  })

  it('with the gather enabled, prices 2+ read-only tool_use events as one collapsed Lookups panel, not one block each', () => {
    vi.mocked(isLookupsGroupingEnabled).mockReturnValue(true)
    const below = {
      turn_id: 't',
      events: [{ type: 'assistant', subtype: 'tool_use', content: 'Read' }],
      userMessage: '',
      attachments: null,
    }
    const atThreshold = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'Read' },
        { type: 'assistant', subtype: 'tool_use', content: 'Grep' },
        { type: 'assistant', subtype: 'tool_use', content: 'Glob' },
      ],
      userMessage: '',
      attachments: null,
    }
    // Below threshold: each read-only call still prices as its own block.
    expect(predictTurnHeight(below, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_TOOL_BLOCK),
    )
    // At/above threshold: 3 read-only calls price as 1 collapsed panel, not 3 blocks.
    expect(predictTurnHeight(atThreshold, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_TOOL_BLOCK),
    )
  })

  it('with the gather disabled (default), every read-only tool_use event prices standalone', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'Read' },
        { type: 'assistant', subtype: 'tool_use', content: 'Grep' },
        { type: 'assistant', subtype: 'tool_use', content: 'Glob' },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + 3 * PX_PER_TOOL_BLOCK),
    )
  })

  it('adds fixed pixels per thinking event AND embedded <thinking> tag', () => {
    const charsPerLine = Math.floor(EFFECTIVE_WIDTH / AVG_CHAR_WIDTH_PX)
    const tag = '<thinking>t</thinking>'
    // Padded to exactly one line so the assertion below needn't replicate the wrap-line ceil().
    const content = 'x'.repeat(charsPerLine - tag.length) + tag
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'thinking', content: '...' },
        { type: 'assistant', subtype: 'text', content },
      ],
      userMessage: '',
      attachments: null,
    }
    // thinking subtype = 1, embedded tag = 1 -> 2 thinking blocks
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(
        TURN_MIN_PREDICTED_HEIGHT_PX,
        TURN_BASE_HEIGHT_PX + LINE_HEIGHT_PX + 2 * PX_PER_THINKING_BLOCK,
      ),
    )
  })

  it('groups attachments into rows of 3 and adds fixed pixels per row', () => {
    // 3 attachments fit in one row; 4 spill to two rows.
    const oneRow = { turn_id: 't', events: [], userMessage: '', attachments: [{}, {}, {}] }
    const twoRows = { turn_id: 't', events: [], userMessage: '', attachments: [{}, {}, {}, {}] }
    expect(predictTurnHeight(oneRow, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_ATTACHMENT_ROW),
    )
    expect(predictTurnHeight(twoRows, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + 2 * PX_PER_ATTACHMENT_ROW),
    )
  })

  it('counts user message lines toward predicted height', () => {
    const charsPerLine = Math.floor(EFFECTIVE_WIDTH / AVG_CHAR_WIDTH_PX)
    const turn = {
      turn_id: 't',
      events: [],
      userMessage: 'u'.repeat(charsPerLine * 3),
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + 3 * LINE_HEIGHT_PX),
    )
  })

  it('floors charsPerLine at 20 to avoid runaway predictions on tiny widths', () => {
    const turn = {
      turn_id: 't',
      events: [{ type: 'assistant', subtype: 'text', content: 'x'.repeat(200) }],
      userMessage: '',
      attachments: null,
    }
    // effectiveWidth 0 -> charsPerLine clamped to 20 -> 200/20 = 10 lines.
    expect(predictTurnHeight(turn, 0)).toBe(TURN_BASE_HEIGHT_PX + 10 * LINE_HEIGHT_PX)
  })

  it('returns only the strip height (base + user lines) when collapsed', () => {
    const charsPerLine = Math.floor(EFFECTIVE_WIDTH / AVG_CHAR_WIDTH_PX)
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'text', content: 'x'.repeat(charsPerLine * 10) },
        { type: 'assistant', subtype: 'tool_use', content: 'Bash' },
      ],
      userMessage: 'u'.repeat(charsPerLine * 2),
      attachments: [{}, {}, {}],
    }
    // Collapsed omits assistant text / tool / attachment contributions; keeps base + 2 user lines.
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH, true)).toBe(
      TURN_BASE_HEIGHT_PX + 2 * LINE_HEIGHT_PX,
    )
    // The expanded prediction is much taller than the collapsed strip.
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH, false)).toBeGreaterThan(
      predictTurnHeight(turn, EFFECTIVE_WIDTH, true),
    )
  })

  it('collapsed height for a turn with no user message is the base strip', () => {
    const turn = {
      turn_id: 't',
      events: [{ type: 'assistant', subtype: 'text', content: 'hello world' }],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH, true)).toBe(TURN_BASE_HEIGHT_PX)
  })

  it('does not price a successful ToolSearch call - it renders nothing', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'ToolSearch', tool_use_id: 'ts-1' },
        { type: 'user', subtype: 'tool_result', tool_use_id: 'ts-1' },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)
  })

  it('does not price a still-pending ToolSearch call (result not seen yet)', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'ToolSearch', tool_use_id: 'ts-1' },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(TURN_MIN_PREDICTED_HEIGHT_PX)
  })

  it('still prices an errored ToolSearch call like any other tool block', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'ToolSearch', tool_use_id: 'ts-1' },
        { type: 'user', subtype: 'tool_result', tool_use_id: 'ts-1', is_error: true },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_TOOL_BLOCK),
    )
  })

  it('prices a mix of hidden ToolSearch and ordinary tool_use correctly', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'tool_use', content: 'ToolSearch', tool_use_id: 'ts-1' },
        { type: 'user', subtype: 'tool_result', tool_use_id: 'ts-1' },
        { type: 'assistant', subtype: 'tool_use', content: 'Edit' },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + PX_PER_TOOL_BLOCK),
    )
  })
})
