/** Tests for ToolBlock. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { TurnProvider } from '../../TurnContext'

vi.mock('../../../../../../utils/eventProcessing', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    processNestedEvents: events => events || [],
  }
})

// useCapabilities depends on SessionData + workspace-defaults contexts; tests
// stub it to return a permissive capability matrix so render paths gated on
// runtime capabilities (e.g. supports_ask_user_question) light up by default.
vi.mock('../../../../../../hooks/useCapabilities', () => ({
  default: () => ({
    capabilities: { supports_ask_user_question: true },
    runtimeName: 'Claude',
  }),
}))

// Mock child components as simple divs with data-testid
vi.mock('./components/ToolBlockHeader', () => ({
  default: props => (
    <div
      data-testid="tool-block-header"
      data-pending={props.toolStatus?.isPending}
      data-awaiting={props.toolStatus?.isAwaitingAnswer}
      data-was-answered={props.toolStatus?.wasAnswered}
      data-was-skipped={props.toolStatus?.wasSkipped}
      data-answer-label={props.toolStatus?.answerLabel || ''}
      onClick={props.onToggle}>
      {props.header}
    </div>
  ),
}))

vi.mock('./components/tool-block-expanded-content/ToolBlockExpandedContent', () => ({
  default: props => (
    <div
      data-testid="tool-block-expanded"
      data-tool-name={props.toolName}
      data-has-tool-input={props.toolInput ? 'true' : 'false'}>
      expanded-content
    </div>
  ),
}))

vi.mock('./components/interactive-questions', () => ({
  default: props => (
    <div data-testid="interactive-questions" data-disabled={props.disabled}>
      <button
        data-testid="submit-answer"
        type="button"
        onClick={() => props.onSubmit('test answer')}>
        Submit
      </button>
      <button
        data-testid="submit-approve"
        type="button"
        onClick={() =>
          props.onSubmit(
            '<response:ExitPlanMode>\n<question header="Plan" text="Review the plan above">\n  <answer>Approve</answer>\n</question>\n</response:ExitPlanMode>',
          )
        }>
        Approve
      </button>
      <button
        data-testid="submit-reject"
        type="button"
        onClick={() =>
          props.onSubmit(
            '<response:ExitPlanMode>\n<question header="Plan" text="Review the plan above">\n  <answer>Reject</answer>\n</question>\n</response:ExitPlanMode>',
          )
        }>
        Reject
      </button>
    </div>
  ),
}))

import ToolBlock from './ToolBlock'

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

/** Render ToolBlock wrapped in TurnProvider with optional context overrides. */
function renderToolBlock(toolBlockProps, contextOverrides = {}) {
  const turnProps = { ...defaultTurnContext, ...contextOverrides }
  return render(
    <TurnProvider {...turnProps}>
      <ToolBlock {...toolBlockProps} />
    </TurnProvider>,
  )
}

/** Rerender ToolBlock wrapped in TurnProvider with optional context overrides. */
function rerenderToolBlock(rerender, toolBlockProps, contextOverrides = {}) {
  const turnProps = { ...defaultTurnContext, ...contextOverrides }
  return rerender(
    <TurnProvider {...turnProps}>
      <ToolBlock {...toolBlockProps} />
    </TurnProvider>,
  )
}

describe('ToolBlock', () => {
  // Read tool: collapses by default, realistic line-numbered content
  const readToolUse = {
    content: 'Read',
    tool_use_id: 'tu-123',
    tool_input: { file_path: '/src/app.js' },
  }

  const readResult = {
    content: '     1\u2192const x = 1\n     2\u2192const y = 2',
  }

  // Bash tool: does NOT collapse by default, multi-line output produces details
  const bashToolUse = {
    content: 'Bash',
    tool_use_id: 'tu-123',
    tool_input: { command: 'ls -la' },
  }

  const bashResult = {
    content: 'file1.txt\nfile2.txt',
  }

  describe('status attributes', () => {
    it('sets data-tool-status to completed for finished tool', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult })

      const block = screen.getByTestId('tool-block')
      expect(block).toHaveAttribute('data-tool-status', 'completed')
    })

    it('sets data-tool-status to pending when tool is running', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: null })

      const block = screen.getByTestId('tool-block')
      expect(block).toHaveAttribute('data-tool-status', 'pending')
    })

    it('sets data-tool-status to error when tool fails', () => {
      const errorResult = {
        content: '<tool_use_error>Error occurred</tool_use_error>',
      }
      renderToolBlock({ toolUse: readToolUse, toolResult: errorResult })

      const block = screen.getByTestId('tool-block')
      expect(block).toHaveAttribute('data-tool-status', 'error')
    })

    it('sets data-tool-use-id from toolUse tool_use_id', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult })

      const block = screen.getByTestId('tool-block')
      expect(block).toHaveAttribute('data-tool-use-id', 'tu-123')
    })

    it('applies tool-error class when result is error', () => {
      const errorResult = {
        content: '<tool_use_error>Something failed</tool_use_error>',
      }
      renderToolBlock({ toolUse: readToolUse, toolResult: errorResult })

      const block = screen.getByTestId('tool-block')
      expect(block).toHaveClass('tool-error')
    })

    it('applies nested class when nested prop is true', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult, nested: true })

      const block = screen.getByTestId('tool-block')
      expect(block).toHaveClass('nested')
    })
  })

  describe('expanded content', () => {
    it('shows expanded content when not collapsed by default', () => {
      renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })

      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
    })

    it('hides expanded content when collapsed by default', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult })

      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()
    })

    it('toggles expanded content on header click', async () => {
      const user = userEvent.setup()
      renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })

      // Initially expanded (Bash does not collapse by default)
      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()

      // Click to collapse
      await user.click(screen.getByTestId('tool-block-header'))
      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()

      // Click to expand again
      await user.click(screen.getByTestId('tool-block-header'))
      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
    })

    it('hides expanded content when tool is pending and not a Task', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: null })

      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()
    })

    it('shows expanded content for pending Task with nested events', () => {
      const taskToolUse = {
        content: 'Task',
        tool_use_id: 'tu-task',
        tool_input: { prompt: 'do something' },
      }
      renderToolBlock({
        toolUse: taskToolUse,
        toolResult: null,
        nestedEvents: [{ type: 'nested-event' }],
      })

      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
    })

    it('shows expanded content with toolInput for pending unhandled tool', () => {
      const mcpToolUse = {
        content: 'mcp__chroma__chroma_query_documents',
        tool_use_id: 'tu-mcp',
        tool_input: { collection_name: 'share', query_texts: ['test'] },
      }
      renderToolBlock({ toolUse: mcpToolUse, toolResult: null })

      const expanded = screen.getByTestId('tool-block-expanded')
      expect(expanded).toBeInTheDocument()
      expect(expanded).toHaveAttribute('data-has-tool-input', 'true')
    })

    it('does not pass toolInput for handled tools', () => {
      renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })

      const expanded = screen.getByTestId('tool-block-expanded')
      expect(expanded).toHaveAttribute('data-has-tool-input', 'false')
    })

    it('does not pass toolInput for unhandled tool with empty input', () => {
      const emptyInputToolUse = {
        content: 'mcp__unknown__tool',
        tool_use_id: 'tu-empty',
        tool_input: {},
      }
      renderToolBlock({
        toolUse: emptyInputToolUse,
        toolResult: { content: 'result' },
      })

      // Single-line result matching summary collapses - no expanded section rendered
      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()
    })
  })

  describe('auto-collapse on Task completion', () => {
    it('collapses when Task transitions from pending to completed with nested events', async () => {
      const taskToolUse = {
        content: 'Task',
        tool_use_id: 'tu-task',
        tool_input: { prompt: 'do something' },
      }

      // Pending with nested events -> expanded
      const { rerender } = renderToolBlock({
        toolUse: taskToolUse,
        toolResult: null,
        nestedEvents: [{ type: 'nested-event' }],
      })

      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()

      // Complete the task
      await act(async () => {
        rerenderToolBlock(rerender, {
          toolUse: taskToolUse,
          toolResult: { content: 'Task completed' },
          nestedEvents: [{ type: 'nested-event' }],
        })
      })

      // Auto-collapse on completion
      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()
    })
  })

  describe('auto-expand on nested events arrival', () => {
    it('expands when pending Task receives nested events', async () => {
      const user = userEvent.setup()
      const taskToolUse = {
        content: 'Task',
        tool_use_id: 'tu-task',
        tool_input: { prompt: 'do something' },
      }

      // Pending Task without nested events (expanded by default)
      const { rerender } = renderToolBlock({
        toolUse: taskToolUse,
        toolResult: null,
        nestedEvents: [],
      })

      // User manually collapses
      await user.click(screen.getByTestId('tool-block-header'))
      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()

      // Nested events arrive -> auto-expand
      await act(async () => {
        rerenderToolBlock(rerender, {
          toolUse: taskToolUse,
          toolResult: null,
          nestedEvents: [{ type: 'nested-event' }],
        })
      })

      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
    })
  })

  describe('AskUserQuestion form rendering', () => {
    const askToolUse = {
      content: 'AskUserQuestion',
      tool_use_id: 'tu-ask',
      tool_input: {
        questions: [
          { question: 'What color?', options: ['red', 'blue'] },
          { question: 'What size?', options: ['S', 'M', 'L'] },
        ],
      },
    }

    it('shows interactive questions when awaiting answer', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: null })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()
    })

    it('shows interactive questions when result says "Answer questions?"', () => {
      const askResult = { content: 'Answer questions?' }
      renderToolBlock({ toolUse: askToolUse, toolResult: askResult })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()
    })

    it('hides interactive questions when already answered via hasNextUserMessage', () => {
      renderToolBlock(
        { toolUse: askToolUse, toolResult: { content: 'answers' } },
        { hasNextUserMessage: true },
      )

      expect(screen.queryByTestId('interactive-questions')).not.toBeInTheDocument()
    })

    it('hides interactive questions after form submit', async () => {
      const user = userEvent.setup()
      const onFormSubmit = vi.fn()

      renderToolBlock({ toolUse: askToolUse, toolResult: null }, { onFormSubmit })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()

      // Submit the form
      await user.click(screen.getByTestId('submit-answer'))

      // Should auto-collapse and hide questions
      expect(screen.queryByTestId('interactive-questions')).not.toBeInTheDocument()
      expect(onFormSubmit).toHaveBeenCalledWith('test answer')
    })

    it('marks questions as disabled when hasPendingMessages', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: null }, { hasPendingMessages: true })

      const questions = screen.getByTestId('interactive-questions')
      expect(questions).toHaveAttribute('data-disabled', 'true')
    })

    it('passes wasAnswered to header when answered locally', async () => {
      const user = userEvent.setup()

      renderToolBlock({ toolUse: askToolUse, toolResult: null }, { onFormSubmit: vi.fn() })

      await user.click(screen.getByTestId('submit-answer'))

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-was-answered', 'true')
    })

    it('detects skip when user types in chat instead of using form', () => {
      const { rerender } = renderToolBlock(
        { toolUse: askToolUse, toolResult: null },
        { hasPendingMessages: false },
      )

      // Simulate user typing in chat (hasPendingMessages transitions to true)
      rerenderToolBlock(
        rerender,
        { toolUse: askToolUse, toolResult: null },
        { hasPendingMessages: true },
      )

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-was-skipped', 'true')
    })

    it('passes wasSkipped to header when skipped on resume', () => {
      renderToolBlock(
        { toolUse: askToolUse, toolResult: { content: 'answers' } },
        { hasNextUserMessage: true, nextUserMessageIsFormResponse: false },
      )

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-was-skipped', 'true')
    })

    it('hides expanded content for answered AskUserQuestion', () => {
      renderToolBlock(
        { toolUse: askToolUse, toolResult: { content: 'answers' } },
        { hasNextUserMessage: true },
      )

      // ToolBlockExpandedContent should not render for answered AskUserQuestion
      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()
    })
  })

  describe('ExitPlanMode form rendering', () => {
    const planToolUse = {
      content: 'ExitPlanMode',
      tool_use_id: 'tu-plan',
      tool_input: { plan: '# Implementation Plan\n\n1. Step one\n2. Step two' },
    }

    // ExitPlanMode result triggers plan extraction from input.plan
    const planResult = {
      content: 'Exit plan mode?',
    }

    it('shows interactive questions when plan is awaiting answer', () => {
      renderToolBlock({ toolUse: planToolUse, toolResult: planResult })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()
    })

    it('hides interactive questions when already answered via hasNextUserMessage', () => {
      renderToolBlock(
        { toolUse: planToolUse, toolResult: planResult },
        { hasNextUserMessage: true },
      )

      expect(screen.queryByTestId('interactive-questions')).not.toBeInTheDocument()
    })

    it('hides interactive questions after form submit', async () => {
      const user = userEvent.setup()
      const onFormSubmit = vi.fn()

      renderToolBlock({ toolUse: planToolUse, toolResult: planResult }, { onFormSubmit })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()

      await user.click(screen.getByTestId('submit-answer'))

      expect(screen.queryByTestId('interactive-questions')).not.toBeInTheDocument()
      expect(onFormSubmit).toHaveBeenCalledWith('test answer')
    })

    it('keeps expanded content viewable for answered ExitPlanMode', () => {
      renderToolBlock(
        { toolUse: planToolUse, toolResult: planResult },
        { hasNextUserMessage: true },
      )

      // Plan content should remain viewable after answering (unlike AskUserQuestion)
      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
    })

    it('passes Approved label to header when approve is selected locally', async () => {
      const user = userEvent.setup()

      renderToolBlock({ toolUse: planToolUse, toolResult: planResult }, { onFormSubmit: vi.fn() })

      await user.click(screen.getByTestId('submit-approve'))

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-answer-label', 'Approved')
    })

    it('passes Rejected label to header when reject is selected locally', async () => {
      const user = userEvent.setup()

      renderToolBlock({ toolUse: planToolUse, toolResult: planResult }, { onFormSubmit: vi.fn() })

      await user.click(screen.getByTestId('submit-reject'))

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-answer-label', 'Rejected')
    })

    it('extracts Approved label from next user message on resume', () => {
      const approveMsg =
        '<response:ExitPlanMode>\n<question header="Plan" text="Review">\n  <answer>Approve</answer>\n</question>\n</response:ExitPlanMode>'

      renderToolBlock(
        { toolUse: planToolUse, toolResult: planResult },
        {
          hasNextUserMessage: true,
          nextUserMessageIsFormResponse: true,
          nextUserMessage: approveMsg,
        },
      )

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-answer-label', 'Approved')
    })

    it('detects skip when user types in chat instead of using form', () => {
      const { rerender } = renderToolBlock(
        { toolUse: planToolUse, toolResult: planResult },
        { hasPendingMessages: false },
      )

      rerenderToolBlock(
        rerender,
        { toolUse: planToolUse, toolResult: planResult },
        { hasPendingMessages: true },
      )

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-was-skipped', 'true')
    })

    it('passes wasSkipped to header when skipped on resume', () => {
      renderToolBlock(
        { toolUse: planToolUse, toolResult: planResult },
        { hasNextUserMessage: true, nextUserMessageIsFormResponse: false },
      )

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-was-skipped', 'true')
    })
  })

  describe('header rendering', () => {
    it('renders header text from buildToolHeader', () => {
      renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })

      expect(screen.getByTestId('tool-block-header')).toHaveTextContent('Bash(ls -la)')
    })

    it('defaults toolName to "Tool" when toolUse content is missing', () => {
      const emptyToolUse = {
        tool_use_id: 'tu-empty',
        tool_input: {},
      }
      renderToolBlock({ toolUse: emptyToolUse, toolResult: bashResult })

      const block = screen.getByTestId('tool-block')
      expect(block).toBeInTheDocument()
    })
  })
})
