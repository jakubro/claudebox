/** Tests for NestedToolWrapper component. */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TurnProvider } from '../../../../../TurnContext'
import NestedToolWrapper from './NestedToolWrapper'

vi.mock('../../../../../../../../../utils/eventProcessing', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    processNestedEvents: events => events || [],
  }
})

// useCapabilities depends on SessionData context which isn't provided here;
// stub it so ToolBlock renders without requiring the full provider tree.
vi.mock('../../../../../../../../../hooks/useCapabilities', () => ({
  default: () => ({
    capabilities: { supports_ask_user_question: true },
    runtimeName: 'Claude',
  }),
}))

// Mock heavy children of ToolBlock to avoid CodeMirror/Markdown/JsonView imports
vi.mock('../../../components/tool-block-expanded-content/ToolBlockExpandedContent', () => ({
  default: () => <div data-testid="tool-block-expanded">expanded-content</div>,
}))

vi.mock('../../../components/interactive-questions', () => ({
  default: () => null,
}))

// Default TurnProvider values for tests
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

/** Render NestedToolWrapper wrapped in TurnProvider with optional context overrides. */
function renderNested(props, contextOverrides = {}) {
  const turnProps = { ...defaultTurnContext, ...contextOverrides }
  return render(
    <TurnProvider {...turnProps}>
      <NestedToolWrapper {...props} />
    </TurnProvider>,
  )
}

describe('NestedToolWrapper', () => {
  const readToolUse = {
    content: 'Read',
    tool_use_id: 'tu-123',
    tool_input: { file_path: '/src/app.js' },
  }

  const readResult = {
    content: '     1\u2192const x = 1\n     2\u2192const y = 2',
  }

  it('renders ToolBlock with nested styling', () => {
    renderNested({ toolUse: readToolUse, toolResult: readResult })

    const block = screen.getByTestId('tool-block')
    expect(block).toHaveClass('nested')
  })

  it('renders tool header from real ToolBlock', () => {
    renderNested({ toolUse: readToolUse, toolResult: readResult })

    expect(screen.getByText('Read(app.js)')).toBeInTheDocument()
  })

  it('looks up todoDiff from todoDiffs Map by tool_use_id', () => {
    const todoToolUse = {
      content: 'TodoWrite',
      tool_use_id: 'tu-todo-1',
      tool_input: {
        todos: [
          { content: 'Task A', status: 'completed' },
          { content: 'Task B', status: 'in_progress' },
        ],
      },
    }
    const todoResult = {
      content: 'Todos updated: 2 items',
    }
    const todoDiffs = new Map([
      [
        'tu-todo-1',
        {
          completed: [{ content: 'Task A' }],
          started: [{ content: 'Task B' }],
          added: [],
          removed: [],
        },
      ],
    ])

    renderNested({ toolUse: todoToolUse, toolResult: todoResult }, { todoDiffs })

    // With todoDiff resolved, ToolBlock summary shows diff counts
    expect(screen.getByText('●1 ◐1')).toBeInTheDocument()
  })

  it('handles missing todoDiffs gracefully', () => {
    renderNested({ toolUse: readToolUse, toolResult: readResult }, { todoDiffs: null })

    const block = screen.getByTestId('tool-block')
    expect(block).toHaveClass('nested')
  })
})
