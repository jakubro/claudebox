/** Tests for predictTurnHeight pure function. */

import { describe, expect, it } from 'vitest'
import {
  AVG_CHAR_WIDTH_PX,
  LINE_HEIGHT_PX,
  PX_PER_ATTACHMENT_ROW,
  PX_PER_THINKING_BLOCK,
  PX_PER_TOOL_BLOCK,
  TURN_BASE_HEIGHT_PX,
  TURN_HORIZONTAL_PADDING_PX,
  TURN_MIN_PREDICTED_HEIGHT_PX,
} from '../../../config/dimensions'
import { predictTurnHeight } from './predictTurnHeight'

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
        { type: 'assistant', subtype: 'tool_use', content: 'Read' },
        { type: 'assistant', subtype: 'tool_use', content: 'Bash' },
      ],
      userMessage: '',
      attachments: null,
    }
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, TURN_BASE_HEIGHT_PX + 2 * PX_PER_TOOL_BLOCK),
    )
  })

  it('adds fixed pixels per thinking event AND embedded <thinking> tag', () => {
    const turn = {
      turn_id: 't',
      events: [
        { type: 'assistant', subtype: 'thinking', content: '...' },
        { type: 'assistant', subtype: 'text', content: 'prose <thinking>x</thinking> more' },
      ],
      userMessage: '',
      attachments: null,
    }
    // thinking subtype = 1, embedded tag = 1 -> 2 thinking blocks
    const expected =
      TURN_BASE_HEIGHT_PX +
      Math.ceil(
        'prose <thinking>x</thinking> more'.length /
          Math.floor(EFFECTIVE_WIDTH / AVG_CHAR_WIDTH_PX),
      ) *
        LINE_HEIGHT_PX +
      2 * PX_PER_THINKING_BLOCK
    expect(predictTurnHeight(turn, EFFECTIVE_WIDTH)).toBe(
      Math.max(TURN_MIN_PREDICTED_HEIGHT_PX, expected),
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
})
