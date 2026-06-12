/** Predictor accuracy regression: measured vs predicted turn heights across content shapes and widths. */

import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { TURN_HORIZONTAL_PADDING_PX } from '../../../src/claudebox_frontend/src/config/dimensions.js'
import { predictTurnHeight } from '../../../src/claudebox_frontend/src/features/chat/utils/predictTurnHeight.js'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSEDynamic } from '../mocks/sse.js'

// --- Fixture matrix ---

const TS = '2026-05-17T12:00:00Z'
let _eventCounter = 0
const nextId = () => `cal-evt-${++_eventCounter}`

/** Build one fixture (turn shape) -> a record consumed by both the predictor and the event-stream builder. */
function fixture(name, { userMessage = 'query', assistantEvents = [], attachments = null }) {
  return { turnId: `cal-${name}`, userMessage, assistantEvents, attachments }
}

function buildFixtures() {
  const fxs = []

  // Pure-text turns across the length axis (drives line-wrapping math)
  for (const chars of [50, 200, 500, 1500, 5000, 15000]) {
    fxs.push(
      fixture(`text-${chars}`, {
        assistantEvents: [{ subtype: 'text', content: 'A'.repeat(chars) }],
      }),
    )
  }

  // Tool-heavy turns (each tool: tool_use + tool_result)
  for (const n of [1, 3, 5, 10]) {
    const toolEvents = []
    for (let i = 0; i < n; i++) {
      toolEvents.push({
        subtype: 'tool_use',
        content: 'Read',
        tool_use_id: `tu-${n}-${i}`,
        tool_name: 'Read',
        tool_input: { file_path: `/path/to/file-${i}` },
      })
      toolEvents.push({
        subtype: 'tool_result',
        content: 'file content line\n'.repeat(3),
        tool_use_id: `tu-${n}-${i}`,
      })
    }
    fxs.push(
      fixture(`tools-${n}`, {
        assistantEvents: [{ subtype: 'text', content: 'I will check.' }, ...toolEvents],
      }),
    )
  }

  // Thinking blocks (small, collapsed by default)
  for (const n of [1, 3]) {
    const thinkEvents = Array.from({ length: n }, () => ({
      subtype: 'thinking',
      content: 'reasoning step '.repeat(20),
    }))
    fxs.push(
      fixture(`thinking-${n}`, {
        assistantEvents: [...thinkEvents, { subtype: 'text', content: 'final response text' }],
      }),
    )
  }

  // Embedded <thinking> XML extracted as thinking blocks during render
  fxs.push(
    fixture('text-with-embedded-thinking', {
      assistantEvents: [
        {
          subtype: 'text',
          content: 'prefix text. <thinking>internal reasoning content here</thinking> suffix text.',
        },
      ],
    }),
  )

  // Attachments
  for (const n of [1, 3]) {
    fxs.push(
      fixture(`attach-${n}`, {
        attachments: Array.from({ length: n }, (_, i) => ({
          type: 'image',
          name: `image-${i}.png`,
          size: 1024,
        })),
        assistantEvents: [{ subtype: 'text', content: 'Acknowledged.' }],
      }),
    )
  }

  // Mixed compositions - closest to real workloads
  fxs.push(
    fixture('mixed-text-and-tool', {
      assistantEvents: [
        { subtype: 'text', content: 'Let me check the file.' },
        {
          subtype: 'tool_use',
          content: 'Read',
          tool_use_id: 'mix-1',
          tool_name: 'Read',
          tool_input: { file_path: '/foo' },
        },
        { subtype: 'tool_result', content: 'contents\n'.repeat(5), tool_use_id: 'mix-1' },
        { subtype: 'text', content: 'Found it. '.repeat(100) },
      ],
    }),
  )

  fxs.push(
    fixture('mixed-all', {
      attachments: [
        { type: 'image', name: 'a.png' },
        { type: 'image', name: 'b.png' },
      ],
      assistantEvents: [
        { subtype: 'thinking', content: 'multi-step reasoning '.repeat(40) },
        { subtype: 'text', content: 'Here is the analysis. '.repeat(80) },
        {
          subtype: 'tool_use',
          content: 'Bash',
          tool_use_id: 'all-1',
          tool_name: 'Bash',
          tool_input: { command: 'ls -la' },
        },
        { subtype: 'tool_result', content: 'output line\n'.repeat(10), tool_use_id: 'all-1' },
      ],
    }),
  )

  // Edge: trivially short (tests MIN floor + short user message)
  fxs.push(
    fixture('trivial-ack', {
      userMessage: 'k',
      assistantEvents: [{ subtype: 'text', content: 'OK' }],
    }),
  )

  // Edge: long user message (multi-line input wrapping)
  fxs.push(
    fixture('long-user-message', {
      userMessage: 'Question: '.repeat(80),
      assistantEvents: [{ subtype: 'text', content: 'Short answer.' }],
    }),
  )

  return fxs
}

function buildEventStream(fxs) {
  const events = []
  for (const f of fxs) {
    if (f.userMessage) {
      const userEvent = {
        type: 'user',
        subtype: 'text',
        is_human: true,
        content: f.userMessage,
        ts: TS,
        turn_id: f.turnId,
        id: nextId(),
        primary: true,
      }
      if (f.attachments?.length) {
        userEvent.attachments = f.attachments
      }
      events.push(userEvent)
    }
    for (const evt of f.assistantEvents) {
      const event = {
        type: 'assistant',
        subtype: evt.subtype || 'text',
        content: evt.content || '',
        ts: TS,
        turn_id: f.turnId,
        id: nextId(),
        primary: false,
        is_human: false,
      }
      if (evt.tool_use_id) {
        event.tool_use_id = evt.tool_use_id
      }
      if (evt.tool_name) {
        event.tool_name = evt.tool_name
      }
      if (evt.tool_input) {
        event.tool_input = evt.tool_input
      }
      events.push(event)
    }
    // Close the turn so the next user message is treated as a new turn.
    events.push({
      type: 'result',
      subtype: 'success',
      turn_id: f.turnId,
      ts: TS,
      id: nextId(),
    })
  }
  return events
}

const FIXTURES = buildFixtures()
const EVENTS = buildEventStream(FIXTURES)
const FIXTURE_BY_ID = new Map(FIXTURES.map(f => [f.turnId, f]))

// --- Test sweep ---

const WIDTHS = [
  { name: 'narrow', viewport: { width: 800, height: 900 } },
  { name: 'default', viewport: { width: 1280, height: 900 } },
  { name: 'wide', viewport: { width: 1800, height: 900 } },
]

const DRIFT_BOUND = 0.3
const DUMP_DIR = '/tmp/predictor-calibration'

/** Convert a fixture's stored assistantEvents to predictor-shaped events (adds `type: 'assistant'`). */
function turnFromFixture(f) {
  return {
    turn_id: f.turnId,
    userMessage: f.userMessage || '',
    attachments: f.attachments,
    events: f.assistantEvents.map(e => ({
      type: 'assistant',
      subtype: e.subtype || 'text',
      content: e.content || '',
    })),
  }
}

// SPEC: chat:minimap-warm-from-cold
test.describe('predictor accuracy regression', () => {
  test.beforeAll(() => {
    fs.mkdirSync(DUMP_DIR, { recursive: true })
  })

  for (const { name, viewport } of WIDTHS) {
    test(`drift < ${(DRIFT_BOUND * 100).toFixed(0)}% across fixture matrix at ${name} width (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await mockAPI(page)
      await mockSSEDynamic(page, () => EVENTS)
      await page.goto(DEFAULT_SESSION_URL)
      await waitForAppReady(page)

      // Force real layout on every turn - content-visibility:auto would return
      // the 400px intrinsic for off-screen turns, masking real layout heights.
      await page.addStyleTag({
        content: '.turn-container { content-visibility: visible !important; }',
      })

      await expect(page.locator('[data-testid="turn-container"]')).toHaveCount(FIXTURES.length, {
        timeout: 15000,
      })
      // Settle layout after style injection.
      await page.waitForTimeout(150)

      const captured = await page.evaluate(
        turnIds => {
          const container = document.querySelector('.chat-messages')
          const containerWidth = container ? container.clientWidth : 0
          return turnIds
            .map(id => {
              const el = document.querySelector(`[data-turn-id="${id}"]`)
              return { turnId: id, measured: el ? el.offsetHeight : null }
            })
            .map(r => ({ ...r, containerWidth }))
        },
        FIXTURES.map(f => f.turnId),
      )

      const records = []
      const failures = []
      for (const c of captured) {
        if (c.measured == null) {
          failures.push(`${c.turnId} not found in DOM`)
          continue
        }
        const f = FIXTURE_BY_ID.get(c.turnId)
        const turn = turnFromFixture(f)
        const effectiveWidth = Math.max(0, c.containerWidth - TURN_HORIZONTAL_PADDING_PX)
        const predicted = predictTurnHeight(turn, effectiveWidth)
        const drift = Math.abs(predicted - c.measured) / c.measured
        records.push({
          turnId: c.turnId,
          containerWidth: c.containerWidth,
          measured: c.measured,
          predicted,
          drift,
          pass: drift < DRIFT_BOUND,
        })
        if (drift >= DRIFT_BOUND) {
          failures.push(
            `${c.turnId.padEnd(32)} measured=${String(c.measured).padStart(5)}px predicted=${String(predicted).padStart(5)}px drift=${(drift * 100).toFixed(1)}%`,
          )
        }
      }

      // Always dump for offline calibration / re-fitting.
      fs.writeFileSync(
        path.join(DUMP_DIR, `calibration-${name}.json`),
        JSON.stringify({ width: viewport.width, records }, null, 2),
      )

      if (failures.length > 0) {
        throw new Error(
          `${failures.length}/${records.length} fixtures exceed ${(DRIFT_BOUND * 100).toFixed(0)}% drift at ${name} width (${viewport.width}px):\n  ${failures.join('\n  ')}`,
        )
      }
    })
  }
})
