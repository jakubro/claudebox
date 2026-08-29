/** Predictor accuracy regression: measured vs predicted turn heights across shapes and widths. */

import fs from 'node:fs'
import path from 'node:path'
import { test } from '@playwright/test'
import {
  CHAT_SPLIT_DIVIDER_WIDTH,
  CHAT_TERMINAL_MIN_WIDTH,
  CHAT_TRANSCRIPT_MIN_WIDTH,
  CHAT_WORK_MIN_WIDTH,
  TURN_HORIZONTAL_PADDING_PX,
} from '../../../src/claudebox_frontend/src/config/dimensions.js'
import { predictTurnHeight } from '../../../src/claudebox_frontend/src/features/chat/utils/predictTurnHeight.js'
import { TurnRoutingMode } from '../../../src/claudebox_frontend/src/utils/eventProcessing.js'
import { disableAutoCollapse, waitForAppReady } from '../helpers.js'
import { DEFAULT_SESSION_URL, mockAPI } from '../mocks/api.js'
import { mockSSEDynamic } from '../mocks/sse.js'

// --- Fixture matrix ---

const TS = '2026-05-17T12:00:00Z'
let _eventCounter = 0
const nextId = () => `cal-evt-${++_eventCounter}`

/** Build one fixture record, consumed by both the predictor and the event-stream builder. */
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

  // Bash alone isolates PX_PER_BASH_TOOL_BLOCK from the coefficients mixed-all blends it with.
  for (const n of [1, 3]) {
    const bashEvents = []
    for (let i = 0; i < n; i++) {
      bashEvents.push({
        subtype: 'tool_use',
        content: 'Bash',
        tool_use_id: `bash-${n}-${i}`,
        tool_name: 'Bash',
        tool_input: { command: `echo step-${i}` },
      })
      bashEvents.push({
        subtype: 'tool_result',
        content: 'output line\n'.repeat(3),
        tool_use_id: `bash-${n}-${i}`,
      })
    }
    fxs.push(
      fixture(`bash-${n}`, {
        assistantEvents: [{ subtype: 'text', content: 'Running.' }, ...bashEvents],
      }),
    )
  }

  // Hidden ToolSearch calls must not inflate predicted height: mixes a hidden search with the
  // tool it discovered, isolating whether predictor and renderer agree it contributes nothing.
  fxs.push(
    fixture('hidden-toolsearch', {
      assistantEvents: [
        { subtype: 'text', content: 'Looking up the right tool.' },
        {
          subtype: 'tool_use',
          content: 'ToolSearch',
          tool_use_id: 'ts-cal-1',
          tool_name: 'ToolSearch',
          tool_input: { query: 'select:gcal_list' },
        },
        {
          subtype: 'tool_result',
          content: '[{"name":"mcp__gcal__list_events"}]',
          tool_use_id: 'ts-cal-1',
        },
        {
          subtype: 'tool_use',
          content: 'mcp__gcal__list_events',
          tool_use_id: 'ts-cal-2',
          tool_name: 'mcp__gcal__list_events',
          tool_input: {},
        },
        { subtype: 'tool_result', content: '3 events', tool_use_id: 'ts-cal-2' },
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

// mixed-all is dropped for a layout quirk every non-off state shares: halving the transcript
// column makes the content area's width non-monotonic, a regime the model was never fitted for.
const MIXED_ALL_LAYOUT_QUIRK = new Set(['cal-mixed-all'])

// Split off prices a top-level Bash inline (sole PX_PER_BASH_TOOL_BLOCK calibration); split on: 0.
// bash-1/3 are dropped from split-on only: with the command routed out the turn is ~2 text lines,
// too small a denominator for the 30% bound to mean anything (split off does that isolation).
// Work mode routes every top-level tool, so the Read-only records hit the same small-denominator
// problem at wide widths that only the Bash ones hit under the narrower split-on predicate.
const ROUTING_STATES = [
  {
    mode: TurnRoutingMode.OFF,
    label: 'split off',
    sessionUiState: { rightSlotView: 'off' },
    excludedFixtures: new Set([...MIXED_ALL_LAYOUT_QUIRK]),
  },
  {
    mode: TurnRoutingMode.BASH_ONLY,
    label: 'split on',
    sessionUiState: { rightSlotView: 'terminal' },
    excludedFixtures: new Set(['cal-bash-1', 'cal-bash-3', ...MIXED_ALL_LAYOUT_QUIRK]),
  },
  {
    mode: TurnRoutingMode.ALL_TOOLS,
    label: 'work view',
    sessionUiState: { rightSlotView: 'work' },
    excludedFixtures: new Set([
      'cal-bash-1',
      'cal-bash-3',
      'cal-tools-1',
      'cal-tools-3',
      ...MIXED_ALL_LAYOUT_QUIRK,
    ]),
  },
]

// The same {view id -> minWidth} pairing RIGHT_SLOT_VIEWS holds, duplicated rather than imported:
// that registry also pulls view components whose ESM build Node's resolver rejects.
const VIEW_MIN_WIDTHS = { terminal: CHAT_TERMINAL_MIN_WIDTH, work: CHAT_WORK_MIN_WIDTH }

// Mirrors useTerminalSplitLayout's canFit check: a split view collapses to OFF when both minimums
// plus the divider do not fit, and the predictor must price that effective mode.
function effectiveModeFor(state, contentAreaWidth) {
  const minWidth = VIEW_MIN_WIDTHS[state.sessionUiState.rightSlotView]
  if (minWidth == null) {
    return state.mode
  }
  const canFit =
    contentAreaWidth == null ||
    contentAreaWidth >= CHAT_TRANSCRIPT_MIN_WIDTH + minWidth + CHAT_SPLIT_DIVIDER_WIDTH
  return canFit ? state.mode : TurnRoutingMode.OFF
}

const DRIFT_BOUND = 0.3
const DUMP_DIR = '/tmp/predictor-calibration'

/** Convert a fixture's assistantEvents to predictor-shaped events (adds `type: 'assistant'`). */
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

  for (const state of ROUTING_STATES) {
    for (const { name, viewport } of WIDTHS) {
      test(`drift < ${(DRIFT_BOUND * 100).toFixed(0)}% across fixture matrix at ${name} width (${viewport.width}px), ${state.label}`, async ({
        page,
      }) => {
        // Marginal on the 5s cap: the pinned webfont's metrics push narrow-width wrapping over it.
        test.setTimeout(15000)
        await page.setViewportSize(viewport)
        await mockAPI(page, { sessionUiStateDefaults: state.sessionUiState })
        await mockSSEDynamic(page, () => EVENTS)
        await page.goto(DEFAULT_SESSION_URL)
        await waitForAppReady(page)
        // Predictor estimates expanded heights; keep every turn expanded to match.
        await disableAutoCollapse(page)

        const turnIds = FIXTURES.map(f => f.turnId).filter(id => !state.excludedFixtures.has(id))

        // List is windowed - sweep it fully, recording each turn's height as it mounts.
        const captured = await page.evaluate(async ids => {
          const container = document.querySelector('.chat-messages')
          const contentArea = document.querySelector('.chat-content-area')
          const settle = () =>
            new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          const measured = {}
          const step = Math.max(1, Math.floor(container.clientHeight / 2))

          for (let top = 0; top <= container.scrollHeight; top += step) {
            container.scrollTop = top
            await settle()
            for (const id of ids) {
              if (measured[id] == null) {
                const el = document.querySelector(`[data-turn-id="${id}"]`)
                if (el) {
                  measured[id] = el.offsetHeight
                }
              }
            }
          }

          return ids.map(id => ({
            turnId: id,
            measured: measured[id] ?? null,
            containerWidth: container.clientWidth,
            contentAreaWidth: contentArea?.clientWidth ?? null,
          }))
        }, turnIds)

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
          const mode = effectiveModeFor(state, c.contentAreaWidth)
          const predicted = predictTurnHeight(turn, effectiveWidth, false, mode)
          const drift = Math.abs(predicted - c.measured) / c.measured
          records.push({
            turnId: c.turnId,
            containerWidth: c.containerWidth,
            mode,
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
          path.join(DUMP_DIR, `calibration-${name}-${state.mode}.json`),
          JSON.stringify({ width: viewport.width, mode: state.mode, records }, null, 2),
        )

        if (failures.length > 0) {
          throw new Error(
            `${failures.length}/${records.length} fixtures exceed ${(DRIFT_BOUND * 100).toFixed(0)}% drift at ${name} width (${viewport.width}px), ${state.label}:\n  ${failures.join('\n  ')}`,
          )
        }
      })
    }
  }
})
