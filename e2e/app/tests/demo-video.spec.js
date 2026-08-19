/** Choreographed demo GIF for the README - a CSV export dropping its last row. */

import { test } from '@playwright/test'
import { waitForAppReady } from '../helpers.js'
import { DEFAULT_WORKSPACE_ID, loadFixture, mockAPI } from '../mocks/api.js'
import { createSSEController } from '../mocks/sse.js'

// --- Event factories ---
// ts() uses the real clock: durations are now - event.ts (future ts clamps to "0s"); +1ms on tie.

let evtSeq = 0
let lastTs = 0
const ts = () => {
  const now = Date.now()
  lastTs = now > lastTs ? now : lastTs + 1
  return new Date(lastTs).toISOString()
}
const nextId = () => `evt_${String(++evtSeq).padStart(3, '0')}`

function userMessage(turnId, content) {
  return {
    type: 'user',
    subtype: 'text',
    is_human: true,
    content,
    turn_id: turnId,
    ts: ts(),
    id: nextId(),
    primary: true,
  }
}

function assistantText(content) {
  return {
    type: 'assistant',
    subtype: 'text',
    content,
    ts: ts(),
    id: nextId(),
    primary: true,
    is_human: false,
  }
}

// parentToolUseId nests a call under a Task block - see ToolBlock.jsx's auto-expand/collapse.
function toolUse(toolName, toolInput, toolUseId, parentToolUseId) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: toolName,
    tool_name: toolName,
    tool_use_id: toolUseId,
    tool_input: toolInput,
    parent_tool_use_id: parentToolUseId,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function toolResult(toolUseId, content, parentToolUseId) {
  return {
    type: 'assistant',
    subtype: 'tool_result',
    content,
    tool_use_id: toolUseId,
    parent_tool_use_id: parentToolUseId,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function turnResult(turnId) {
  return {
    type: 'result',
    subtype: 'success',
    turn_id: turnId,
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

// TaskCreate/TaskUpdate group into one itemized "Todos" block (TASK_LIST_TOOLS); TodoWrite won't.

function taskCreate(toolUseId, subject, description, activeForm) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: 'TaskCreate',
    tool_name: 'TaskCreate',
    tool_use_id: toolUseId,
    tool_input: { subject, description, activeForm },
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

/** appendTaskDiffs binds a TaskUpdate's taskId to this result's tool_use_result.task.id. */
function taskCreateResult(toolUseId, taskId, subject) {
  return {
    type: 'user',
    subtype: 'tool_result',
    content: `Task #${taskId} created successfully: ${subject}`,
    tool_use_id: toolUseId,
    tool_use_result: { task: { id: String(taskId), subject } },
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function taskUpdate(toolUseId, taskId, patch) {
  return {
    type: 'assistant',
    subtype: 'tool_use',
    content: 'TaskUpdate',
    tool_name: 'TaskUpdate',
    tool_use_id: toolUseId,
    tool_input: { taskId: String(taskId), ...patch },
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

function taskUpdateResult(toolUseId, taskId, updatedFields) {
  return {
    type: 'user',
    subtype: 'tool_result',
    content: `Task #${taskId} updated`,
    tool_use_id: toolUseId,
    tool_use_result: { success: true, taskId: String(taskId), updatedFields },
    ts: ts(),
    id: nextId(),
    primary: false,
    is_human: false,
  }
}

// --- Helpers ---

const wait = ms => new Promise(r => setTimeout(r, ms))

// One knob to retime every post-capture beat without touching each call site.
const PACE = 1.0
const pwait = ms => wait(ms * PACE)

/** Jump chat scroll to bottom in one discrete step - never animated (kills GIF delta-encoding). */
async function scrollToBottom(page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="chat-messages"]')
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  })
}

/** Send an SSE event, jump-scroll, and hold for the beat's pacing (setup phase, unscaled). */
async function beat(controller, page, event, delayMs = 400) {
  await controller.sendEvent(event)
  await scrollToBottom(page)
  await wait(delayMs)
}

/** Same as beat(), but scaled by PACE - use for every beat once frame capture has started. */
async function pbeat(controller, page, event, delayMs = 400) {
  await controller.sendEvent(event)
  await scrollToBottom(page)
  await pwait(delayMs)
}

/** Click ripple following real pointer events - dispatchEvent bypasses real coordinates. */
async function injectClickHighlight(page) {
  await page.addStyleTag({
    content: `
      .demo-click-ripple {
        position: fixed;
        pointer-events: none;
        z-index: 999999;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: rgba(66, 133, 244, 0.5);
        border: 2px solid rgba(66, 133, 244, 0.8);
        transform: translate(-50%, -50%) scale(0.3);
        animation: demo-ripple 0.6s ease-out forwards;
      }
      @keyframes demo-ripple {
        0%   { transform: translate(-50%, -50%) scale(0.3); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(2.2); opacity: 0; }
      }
    `,
  })
  await page.evaluate(() => {
    document.addEventListener(
      'click',
      e => {
        const dot = document.createElement('div')
        dot.className = 'demo-click-ripple'
        dot.style.left = `${e.clientX}px`
        dot.style.top = `${e.clientY}px`
        document.body.appendChild(dot)
        setTimeout(() => dot.remove(), 650)
      },
      true,
    )
  })
}

/** Legibility zoom: 11-12px type falls under 9px once GitHub downscales the frame. */
async function injectLegibilityZoom(page) {
  await page.addStyleTag({ content: 'body { zoom: 1.15; }' })
}

// --- Scenario content ---
// Invented: no real session/product/codebase, no foo/bar placeholders; only the shape is realistic.

const WRITER_BEFORE = `def write_rows(rows: list[dict], path: str) -> None:
    with open(path, "w") as f:
        f.write("\\n".join(format_row(r) for r in rows))`

const WRITER_AFTER = `def write_rows(rows: list[dict], path: str) -> None:
    with open(path, "w") as f:
        f.write("\\n".join(format_row(r) for r in rows))
        f.write("\\n")`

const READER_SNIPPET = `def read_rows(path: str) -> list[str]:
    with open(path) as f:
        return f.read().split("\\n")`

const TEST_RESULT = '9 passed in 0.3s'

const TASKS = [
  {
    subject: 'Confirm the last row is dropped when reproduced locally',
    description: 'Write a small file with no trailing newline and read it back',
    activeForm: 'Confirming the dropped row',
  },
  {
    subject: 'Check whether the reader or the writer is responsible',
    description: 'Trace where the unterminated line goes missing',
    activeForm: 'Checking reader vs writer',
  },
  {
    subject: 'Always terminate the last row with a newline',
    description: 'Fix the writer instead of the reader',
    activeForm: 'Terminating the last row',
  },
  {
    subject: 'Add a regression test for a file with no trailing newline',
    description: 'Assert the last row survives a round trip',
    activeForm: 'Adding a regression test',
  },
  {
    subject: 'Run the full suite to confirm no regressions',
    description: 'pytest tests/export/',
    activeForm: 'Running the full suite',
  },
]

// --- Layout preload ---
// Panel ids match config/layout.js (main, not stale fixtures' chat); 3 right panels, 5 is cramped.

function buildDemoLayout() {
  return {
    layout: {
      grid: {
        root: {
          type: 'branch',
          data: [
            {
              type: 'leaf',
              data: { views: ['sessions'], activeView: 'sessions', id: 'sessions' },
              size: 260,
            },
            {
              type: 'leaf',
              data: { views: ['main'], activeView: 'main', id: 'main' },
              size: 1141,
            },
            {
              type: 'branch',
              data: [
                {
                  type: 'leaf',
                  data: { views: ['todos'], activeView: 'todos', id: 'todos' },
                  size: 350,
                },
                {
                  type: 'leaf',
                  data: { views: ['tasks'], activeView: 'tasks', id: 'tasks' },
                  size: 350,
                },
                {
                  type: 'leaf',
                  data: { views: ['stash'], activeView: 'stash', id: 'stash' },
                  size: 350,
                },
              ],
              size: 279,
            },
          ],
          size: 1050,
        },
        width: 1680,
        height: 1050,
        orientation: 'HORIZONTAL',
      },
      panels: {
        sessions: {
          id: 'sessions',
          contentComponent: 'sessions',
          tabComponent: 'icon',
          title: 'Sessions',
        },
        main: { id: 'main', contentComponent: 'main', tabComponent: 'icon', title: 'Main' },
        todos: { id: 'todos', contentComponent: 'todos', tabComponent: 'icon', title: 'Todos' },
        tasks: { id: 'tasks', contentComponent: 'tasks', tabComponent: 'icon', title: 'Tasks' },
        stash: { id: 'stash', contentComponent: 'stash', tabComponent: 'icon', title: 'Stash' },
      },
      activeGroup: 'main',
    },
    panelGroups: {
      left: { width: 260, order: ['sessions'] },
      right: { width: 279, order: ['todos', 'tasks', 'stash'] },
    },
    stash: [
      {
        text: 'check other export formats for the same trailing-newline gap',
        timestamp: 1737200000000,
      },
    ],
    updated_at: '2025-01-18T12:00:00Z',
    // The showcase keeps the terminal pane on-screen; the app default is off.
    terminalSplitEnabled: true,
  }
}

// --- Frame capture ---
// Screenshots, not video: no ffmpeg/VP8 decoder, and screenshots preserve deviceScaleFactor.
// A shot costs >100ms, so shoot to a wall-clock deadline; demo-gif.py paces by frames landed.
async function captureFrames(page, { outDir, durationMs }) {
  const fs = await import('node:fs')
  fs.mkdirSync(outDir, { recursive: true })
  const start = Date.now()
  let i = 0
  while (Date.now() - start < durationMs) {
    await page
      .screenshot({ path: `${outDir}/frame_${String(i).padStart(4, '0')}.png` })
      .catch(() => {})
    i++
  }
}

// --- Demo script ---

test.use({
  viewport: { width: 1680, height: 1050 },
  deviceScaleFactor: 2,
})

test.describe('Demo Video', () => {
  test('claudebox showcase', async ({ page }) => {
    test.setTimeout(180000)

    const session = loadFixture('sessions/demo.json').sessions[0]
    const layout = buildDemoLayout()
    await mockAPI(page, {
      sessionsFixture: 'sessions/demo.json',
      statusFixture: 'status/demo.json',
      handlers: {
        async getUIState(route) {
          if (route.request().method() === 'GET') {
            await route.fulfill({ json: { global: {}, session: layout } })
          } else {
            await route.fulfill({ status: 200, json: { global: {}, session: layout } })
          }
        },
      },
    })

    const controller = await createSSEController(page)

    await page.goto(`/#/workspaces/${DEFAULT_WORKSPACE_ID}/sessions/${session.session_id}`)
    await waitForAppReady(page)
    await injectClickHighlight(page)
    await injectLegibilityZoom(page)

    // --- Setup (not captured): the turn is already underway - opens mid-task, no cold open. ---

    const turnId = 'turn_001'
    await beat(
      controller,
      page,
      userMessage(turnId, 'The last row of every CSV export is missing - can you find out why?'),
      200,
    )
    await beat(controller, page, assistantText('Looking at the export writer.'), 250)
    await beat(
      controller,
      page,
      toolUse('Read', { file_path: 'src/export/csv_writer.py' }, 'tool_001'),
      200,
    )
    await beat(controller, page, toolResult('tool_001', WRITER_BEFORE), 250)

    // Bulk-create the list up front (real usage at bootstrap) - a contiguous TaskCreate run merges
    // into one grouped "Todos" block showing every item, not five separate ones.
    for (let i = 0; i < TASKS.length; i++) {
      const id = i + 1
      const t = TASKS[i]
      await beat(
        controller,
        page,
        taskCreate(`tc${id}`, t.subject, t.description, t.activeForm),
        80,
      )
      await beat(controller, page, taskCreateResult(`tc${id}`, id, t.subject), 100)
    }
    await beat(controller, page, taskUpdate('tu0', 1, { status: 'in_progress' }), 100)
    await beat(controller, page, taskUpdateResult('tu0', 1, ['status']), 150)

    // ~51s of choreography below plus a trailing hold - see captureFrames' own comment for why
    // this is wall-clock-bounded rather than a fixed frame count.
    const outDir = '/tmp/claudebox--demo-frames'
    const capture = captureFrames(page, { outDir, durationMs: 60000 })

    await pbeat(
      controller,
      page,
      assistantText(
        'The writer joins rows with newlines but never terminates the last one. A reader that ' +
          'splits on newline treats an unterminated final line as incomplete and drops it.',
      ),
      3500,
    )
    await pbeat(
      controller,
      page,
      toolUse(
        'Task',
        {
          description: 'Research whether CSV readers require a trailing newline',
          prompt:
            'Check whether line-oriented CSV readers treat an unterminated final record as ' +
            'valid, and cite the relevant spec.',
          subagent_type: 'general-purpose',
        },
        'task_001',
      ),
      1500,
    )
    await pbeat(
      controller,
      page,
      toolUse(
        'WebFetch',
        {
          url: 'https://www.rfc-editor.org/rfc/rfc4180',
          prompt: 'Does the format require a trailing newline on the last record?',
        },
        'task_001_web',
        'task_001',
      ),
      1500,
    )
    await pbeat(
      controller,
      page,
      toolResult(
        'task_001_web',
        "RFC 4180 doesn't mandate a trailing CRLF on the last record - readers are expected to " +
          'accept it either way.',
        'task_001',
      ),
      2000,
    )
    await pbeat(
      controller,
      page,
      toolUse('Read', { file_path: 'src/export/csv_reader.py' }, 'task_001_read', 'task_001'),
      1500,
    )
    await pbeat(controller, page, toolResult('task_001_read', READER_SNIPPET, 'task_001'), 2000)
    await pbeat(
      controller,
      page,
      toolResult(
        'task_001',
        "RFC 4180 doesn't require a trailing newline, but our reader splits on '\\n' and silently " +
          'drops an unterminated final record - confirmed that is the actual bug.',
      ),
      3000,
    )

    await pbeat(controller, page, taskUpdate('tu1', 1, { status: 'completed' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu1', 1, ['status']), 600)
    await pbeat(controller, page, taskUpdate('tu2', 2, { status: 'in_progress' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu2', 2, ['status']), 800)
    await pbeat(
      controller,
      page,
      assistantText('The writer should always terminate the last row, not rely on the caller.'),
      4000,
    )
    await pbeat(
      controller,
      page,
      toolUse(
        'Edit',
        {
          file_path: 'src/export/csv_writer.py',
          old_string: WRITER_BEFORE,
          new_string: WRITER_AFTER,
        },
        'tool_002',
      ),
      3500,
    )
    await pbeat(
      controller,
      page,
      toolResult('tool_002', 'The file src/export/csv_writer.py has been updated.'),
      2000,
    )
    await pbeat(controller, page, taskUpdate('tu3', 2, { status: 'completed' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu3', 2, ['status']), 600)
    await pbeat(controller, page, taskUpdate('tu4', 3, { status: 'in_progress' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu4', 3, ['status']), 800)
    await pbeat(
      controller,
      page,
      toolUse(
        'Edit',
        {
          file_path: 'tests/export/test_csv_writer.py',
          old_string: 'def test_write_rows_separates_with_newlines():',
          new_string:
            'def test_write_rows_separates_with_newlines():\n    ...\n\n\ndef test_write_rows_terminates_last_row():',
        },
        'tool_003',
      ),
      3500,
    )
    await pbeat(
      controller,
      page,
      toolResult('tool_003', 'The file tests/export/test_csv_writer.py has been updated.'),
      2000,
    )
    await pbeat(controller, page, taskUpdate('tu5', 3, { status: 'completed' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu5', 3, ['status']), 600)
    await pbeat(controller, page, taskUpdate('tu6', 4, { status: 'in_progress' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu6', 4, ['status']), 800)
    await pbeat(
      controller,
      page,
      toolUse('Bash', { command: 'pytest tests/export/test_csv_writer.py -v' }, 'tool_004'),
      3000,
    )
    await pbeat(controller, page, toolResult('tool_004', TEST_RESULT), 3500)
    await pbeat(controller, page, taskUpdate('tu7', 4, { status: 'completed' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu7', 4, ['status']), 600)
    await pbeat(controller, page, taskUpdate('tu8', 5, { status: 'in_progress' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu8', 5, ['status']), 600)
    await pbeat(controller, page, taskUpdate('tu9', 5, { status: 'completed' }), 500)
    await pbeat(controller, page, taskUpdateResult('tu9', 5, ['status']), 800)
    await pbeat(
      controller,
      page,
      assistantText(
        'The export now always terminates its last row - verified against a file with no trailing ' +
          'newline, with a regression test guarding the case.',
      ),
      4500,
    )
    await pbeat(controller, page, turnResult(turnId), 3000)

    await capture

    await page.close()
  })
})
