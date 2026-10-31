/** Tests for input typed while a session is created. */

import { describe, expect, it } from 'vitest'
import { heldCreations, joinReturned } from './creationInput'

describe('heldCreations', () => {
  it('names each creation once, ignoring items no creation holds', () => {
    const items = [
      { owner: { creation: 2 } },
      {},
      { owner: { creation: 2 } },
      { owner: { creation: 3 } },
    ]

    expect([...heldCreations(items)]).toEqual([2, 3])
  })
})

describe('joinReturned', () => {
  it('appends texts a blank line apart and keeps every attachment', () => {
    const prev = { rawPrompt: 'first', currentAttachments: [{ id: 'a' }] }

    expect(joinReturned(prev, [{ content: 'second', attachments: [{ id: 'b' }] }])).toEqual({
      rawPrompt: 'first\n\nsecond',
      currentAttachments: [{ id: 'a' }, { id: 'b' }],
    })
  })
})
