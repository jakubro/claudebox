/** A side thread's own events, arranged so the turn builder draws one turn per exchange. */

import { EventType } from '../../../../config/schema'
import { flushBatch, initialState } from '../../../../context/utils/eventsReducer'
import { isHumanEvent } from '../../../../utils/eventPredicates'
import { isVisibleEvent } from '../../../../utils/eventProcessing'
import { isForkDivider } from '../../utils/turnFold'

/** Slice a thread's persisted log past its last fork divider, keeping only its own exchanges. */
export function threadOwnEvents(events) {
  let seam = -1

  for (let i = 0; i < events.length; i++) {
    if (isForkDivider(events[i])) {
      seam = i
    }
  }

  return seam === -1 ? events : events.slice(seam + 1)
}

/**
 * Derive a thread's turns, and the maps their blocks read, with the conversation's own reducer.
 * Given `quote`, the first question is drawn without the quote block it was sent under.
 */
export function deriveThreadTurns(events, pending, quote = null) {
  return flushBatch(initialState, _withoutQuoteBlock(arrangeThreadEvents(events, pending), quote))
}

/** Render a quote as a markdown blockquote, every line marked - an empty one as a bare `>`. */
export function quoteBlock(quote) {
  return quote
    .split('\n')
    .map(line => (line ? `> ${line}` : '>'))
    .join('\n')
}

/**
 * Order events for the turn builder: unechoed questions sit where asked; late events rejoin theirs.
 * @param {Array<{content: string, at: number}>} pending - `at` counts the events already arrived.
 */
export function arrangeThreadEvents(events, pending) {
  const segments = [[]]
  const segmentByTurnId = new Map()
  let current = segments[0]
  let nextPending = 0

  const open = head => {
    current = [head]
    segments.push(current)
  }

  const openPendingUpTo = index => {
    while (nextPending < pending.length && pending[nextPending].at <= index) {
      open(_pendingQuestion(pending[nextPending].content))
      nextPending++
    }
  }

  for (let i = 0; i < events.length; i++) {
    const event = events[i]

    openPendingUpTo(i)

    if (_opensExchange(event)) {
      open(event)

      if (event.turn_id) {
        segmentByTurnId.set(event.turn_id, current)
      }
    } else {
      const owner = segmentByTurnId.get(event.turn_id) ?? current

      owner.push(event)
    }
  }

  openPendingUpTo(Number.POSITIVE_INFINITY)

  return segments.flat()
}

/** A thread's own events up to where its second exchange opens - the first exchange alone. */
export function openingExchange(events) {
  const own = threadOwnEvents(events)
  const opens = own.flatMap((event, i) => (_opensExchange(event) ? [i] : []))

  return opens.length > 1 ? own.slice(0, opens[1]) : own
}

/** Count a thread's exchanges - every question asked, echoed back or still waiting. */
export function countExchanges(events, pending) {
  return events.filter(_opensExchange).length + pending.length
}

function _withoutQuoteBlock(events, quote) {
  const first = quote == null ? -1 : events.findIndex(_opensExchange)
  const prefix = first === -1 ? null : `${quoteBlock(quote)}\n\n`

  if (!(prefix && events[first].content.startsWith(prefix))) {
    return events
  }

  const stripped = [...events]
  stripped[first] = { ...events[first], content: events[first].content.slice(prefix.length) }

  return stripped
}

function _pendingQuestion(content) {
  return { type: EventType.USER, subtype: 'text', is_human: true, content, turn_id: null }
}

function _opensExchange(event) {
  return isHumanEvent(event) && !event.parent_tool_use_id && isVisibleEvent(event)
}
