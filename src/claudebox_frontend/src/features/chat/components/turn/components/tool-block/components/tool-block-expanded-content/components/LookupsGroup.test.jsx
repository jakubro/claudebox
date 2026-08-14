/** Tests for LookupsGroup component. */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '../../../../../../../../../config/schema'
import useEditorTemplate from '../../../../../../../../../hooks/useEditorTemplate'
import { TurnProvider } from '../../../../../TurnContext'
import LookupsGroup from './LookupsGroup'

vi.mock('../../../../../../../../../hooks/useEditorTemplate', () => ({
  default: vi.fn(() => null),
}))

vi.mock('../../../../../../../../../utils/eventProcessing', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    processNestedEvents: events => events || [],
  }
})

// Stub useCapabilities (needs SessionData context, not provided here) so ToolBlock renders.
vi.mock('../../../../../../../../../hooks/useCapabilities', () => ({
  default: () => ({
    capabilities: { supports_ask_user_question: true },
    runtimeName: 'Claude',
  }),
}))

vi.mock('../../../components/tool-block-expanded-content/ToolBlockExpandedContent', () => ({
  default: () => <div data-testid="tool-block-expanded">expanded-content</div>,
}))

vi.mock('../../../components/interactive-questions', () => ({
  default: () => null,
}))

const defaultTurnContext = {
  hasNextUserMessage: false,
  nextUserMessageIsFormResponse: false,
  nextUserMessage: null,
  hasPendingMessages: false,
  todoDiffs: null,
  taskNotifications: null,
  onFormSubmit: undefined,
  turnStartTime: null,
  now: null,
  isActiveTurn: false,
}

/** Render LookupsGroup wrapped in TurnProvider with optional context overrides. */
function renderGroup(props, contextOverrides = {}) {
  const turnProps = { ...defaultTurnContext, ...contextOverrides }
  return render(
    <TurnProvider {...turnProps}>
      <LookupsGroup {...props} />
    </TurnProvider>,
  )
}

/** Build a gather-pass entry: { block: { type: TOOL, toolUse, toolResult }, index }. */
function entry(content, id, index) {
  return {
    block: {
      type: BlockType.TOOL,
      toolUse: { content, tool_use_id: id, tool_input: { file_path: `/${id}.js` } },
      toolResult: { content: `result for ${id}` },
    },
    index,
  }
}

describe('LookupsGroup', () => {
  afterEach(() => {
    useEditorTemplate.mockReturnValue(null)
  })

  it('mounts inside the shared ToolBlock chrome with the static "Lookups" header', () => {
    renderGroup({ entries: [entry('Read', 'r1', 0), entry('Grep', 'g1', 1)], blockOffsets: [] })

    const host = screen.getByTestId('lookups-group')
    expect(host).toHaveClass('tool-block')
    expect(host.querySelector('.tool-name').textContent).toBe('Lookups')
  })

  it('renders per-tool counts in first-appearance order', () => {
    renderGroup({
      entries: [entry('Read', 'r1', 0), entry('Grep', 'g1', 1), entry('Read', 'r2', 2)],
      blockOffsets: [],
    })

    expect(document.querySelector('.tool-summary').textContent).toBe('Read x2, Grep x1')
  })

  it('opens collapsed by default - no rows visible until toggled', () => {
    renderGroup({ entries: [entry('Read', 'r1', 0), entry('Grep', 'g1', 1)], blockOffsets: [] })

    expect(screen.queryByTestId('lookups-group-rows')).not.toBeInTheDocument()
  })

  it('toggles the row body when the chrome header is clicked', () => {
    renderGroup({ entries: [entry('Read', 'r1', 0), entry('Grep', 'g1', 1)], blockOffsets: [] })

    fireEvent.click(document.querySelector('.tool-header-area'))
    expect(screen.getByTestId('lookups-group-rows')).toBeInTheDocument()

    fireEvent.click(document.querySelector('.tool-header-area'))
    expect(screen.queryByTestId('lookups-group-rows')).not.toBeInTheDocument()
  })

  it('renders one nested ToolBlock row per entry, in call order', () => {
    renderGroup({
      entries: [entry('Read', 'r1', 0), entry('Read', 'r2', 1), entry('Read', 'r3', 2)],
      blockOffsets: [],
    })
    fireEvent.click(document.querySelector('.tool-header-area'))

    const rows = screen.getAllByTestId('tool-block')
    expect(rows).toHaveLength(3)
    expect(rows.every(row => row.classList.contains('nested'))).toBe(true)
    expect(rows.map(row => row.querySelector('.tool-name').textContent)).toEqual([
      'Read(r1.js)',
      'Read(r2.js)',
      'Read(r3.js)',
    ])
  })

  it('each row expands independently', () => {
    renderGroup({ entries: [entry('Read', 'r1', 0), entry('Read', 'r2', 1)], blockOffsets: [] })
    fireEvent.click(document.querySelector('.tool-header-area')) // open the panel

    const [row1, row2] = screen.getAllByTestId('tool-block')
    fireEvent.click(row1.querySelector('.tool-header-area'))

    expect(row1.querySelector('[data-testid="tool-block-expanded"]')).toBeInTheDocument()
    expect(row2.querySelector('[data-testid="tool-block-expanded"]')).not.toBeInTheDocument()
  })

  it('rows for file tools carry the open-in-editor affordance when a template is configured', () => {
    useEditorTemplate.mockReturnValue('vscode://file/{path}:{line}')
    renderGroup({ entries: [entry('Read', 'r1', 0), entry('Grep', 'g1', 1)], blockOffsets: [] })
    fireEvent.click(document.querySelector('.tool-header-area'))

    const [readRow, grepRow] = screen.getAllByTestId('tool-block')
    expect(readRow.querySelector('.tool-open-in-editor-btn')).toBeInTheDocument()
    expect(grepRow.querySelector('.tool-open-in-editor-btn')).not.toBeInTheDocument()
  })

  it('rows carry no affordance when no template is configured', () => {
    renderGroup({ entries: [entry('Read', 'r1', 0)], blockOffsets: [] })
    fireEvent.click(document.querySelector('.tool-header-area'))

    const [readRow] = screen.getAllByTestId('tool-block')
    expect(readRow.querySelector('.tool-open-in-editor-btn')).not.toBeInTheDocument()
  })
})
