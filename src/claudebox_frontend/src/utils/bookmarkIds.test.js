/** Tests for bookmark id parsing and keys. */

import { describe, expect, it } from 'vitest'
import {
  bookmarkJumpOptions,
  paragraphBookmarkKey,
  parseBookmarkId,
  toolBookmarkKey,
  toolJumpOptions,
} from './bookmarkIds'

describe('parseBookmarkId', () => {
  it.each([
    ['turn_1:user', { turnId: 'turn_1', messageType: 'user', role: 'user', target: null }],
    [
      'turn_1:assistant',
      { turnId: 'turn_1', messageType: 'assistant', role: 'assistant', target: null },
    ],
    [
      'turn_1:p-evt_002-0-3',
      {
        turnId: 'turn_1',
        messageType: 'p-evt_002-0-3',
        role: 'assistant',
        target: { kind: 'paragraph', textId: 'evt_002-0', block: 3 },
      },
    ],
    [
      'a:b:p-evt-with-dashes-1-12',
      {
        turnId: 'a:b',
        messageType: 'p-evt-with-dashes-1-12',
        role: 'assistant',
        target: { kind: 'paragraph', textId: 'evt-with-dashes-1', block: 12 },
      },
    ],
    [
      'turn_1:tool-toolu_01AbC',
      {
        turnId: 'turn_1',
        messageType: 'tool-toolu_01AbC',
        role: 'assistant',
        target: { kind: 'tool', toolUseId: 'toolu_01AbC' },
      },
    ],
  ])('parses %s', (id, expected) => {
    expect(parseBookmarkId(id)).toEqual(expected)
  })

  it('round-trips the keys it builds', () => {
    const paragraph = paragraphBookmarkKey('evt_002', 1, 4)
    const tool = toolBookmarkKey('toolu_9')

    expect(parseBookmarkId(`t:${paragraph}`).target).toEqual({
      kind: 'paragraph',
      textId: 'evt_002-1',
      block: 4,
    })
    expect(parseBookmarkId(`t:${tool}`).target).toEqual({ kind: 'tool', toolUseId: 'toolu_9' })
  })
})

describe('bookmark keys', () => {
  it.each([
    ['an id with a dot', 'evt.002'],
    ['an id with a colon', 'evt:002'],
    ['a missing id', undefined],
  ])('rejects %s', (_, id) => {
    expect(paragraphBookmarkKey(id, 0, 0)).toBeNull()
    expect(toolBookmarkKey(id)).toBeNull()
  })
})

describe('toolJumpOptions', () => {
  it('lands on the tool call the way a tool bookmark does', () => {
    expect(toolJumpOptions('t9', 'c9')).toEqual({
      turnId: 't9',
      messageType: 'assistant',
      target: 'tool-c9',
    })
  })
})

describe('bookmarkJumpOptions', () => {
  it('names the part of a part bookmark on an assistant segment', () => {
    expect(bookmarkJumpOptions('t', 'tool-x')).toEqual({
      turnId: 't',
      messageType: 'assistant',
      target: 'tool-x',
    })
  })

  it('keeps a whole-message bookmark as it is', () => {
    expect(bookmarkJumpOptions('t', 'user')).toEqual({ turnId: 't', messageType: 'user' })
  })
})
