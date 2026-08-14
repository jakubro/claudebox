/** Tests for ToolBlock. */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import useEditorTemplate from '../../../../../../hooks/useEditorTemplate'
import { TurnProvider } from '../../TurnContext'

vi.mock('../../../../../../hooks/useEditorTemplate', () => ({
  default: vi.fn(() => null),
}))

vi.mock('../../../../../../utils/eventProcessing', async importOriginal => {
  const actual = await importOriginal()
  return {
    ...actual,
    processNestedEvents: events => events || [],
  }
})

// useCapabilities depends on SessionData + workspace-defaults contexts; stub it to a permissive
// matrix so paths gated on runtime capabilities (e.g. supports_ask_user_question) light up.
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
      data-is-error={props.toolStatus?.isError}
      data-summary={props.summary || ''}
      data-answer-label={props.toolStatus?.answerLabel || ''}
      data-editor-url={props.editorUrl || ''}
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
  afterEach(() => {
    useEditorTemplate.mockReturnValue(null)
  })

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

    it('shows expanded content for a pending Bash with a command', () => {
      renderToolBlock({ toolUse: bashToolUse, toolResult: null })

      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
    })

    it('hides expanded content for a pending Bash with no command yet', () => {
      const streamingBashToolUse = { content: 'Bash', tool_use_id: 'tu-stream', tool_input: {} }
      renderToolBlock({ toolUse: streamingBashToolUse, toolResult: null })

      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()
    })

    it('collapses and re-expands a pending Bash block on header click', async () => {
      const user = userEvent.setup()
      renderToolBlock({ toolUse: bashToolUse, toolResult: null })

      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()

      await user.click(screen.getByTestId('tool-block-header'))
      expect(screen.queryByTestId('tool-block-expanded')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('tool-block-header'))
      expect(screen.getByTestId('tool-block-expanded')).toBeInTheDocument()
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

  describe('AskUserQuestion block chrome', () => {
    const askToolUse = {
      content: 'AskUserQuestion',
      tool_use_id: 'tu-ask',
      tool_input: {
        questions: [{ question: 'What color?', options: ['red', 'blue'] }],
      },
    }

    // The runtime can report the question tool as unavailable while the form was shown and
    // answered normally, so an answered block must not inherit that failure.
    const askErrorResult = {
      content:
        '<tool_use_error>Error: No such tool available: AskUserQuestion. AskUserQuestion exists but is not enabled in this context.</tool_use_error>',
    }

    it('hides the block header while a question awaits an answer', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: null })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()
      expect(screen.queryByTestId('tool-block-header')).not.toBeInTheDocument()
    })

    it('hides the block header when the awaiting marker is in the result', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: { content: 'Answer questions?' } })

      expect(screen.queryByTestId('tool-block-header')).not.toBeInTheDocument()
    })

    it('restores the block header after the form is submitted', async () => {
      const user = userEvent.setup()

      renderToolBlock({ toolUse: askToolUse, toolResult: null }, { onFormSubmit: vi.fn() })
      expect(screen.queryByTestId('tool-block-header')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('submit-answer'))

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute('data-was-answered', 'true')
    })

    it('keeps the block header for a question answered in an earlier session', () => {
      renderToolBlock(
        { toolUse: askToolUse, toolResult: { content: 'answers' } },
        { hasNextUserMessage: true, nextUserMessageIsFormResponse: true },
      )

      expect(screen.getByTestId('tool-block-header')).toBeInTheDocument()
    })

    it('hides the block header when the form is disabled by pending messages', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: null }, { hasPendingMessages: true })

      // Mounting already-pending never fires the skip effect's false->true edge, so the question
      // stays unanswered and the form stays live, just disabled.
      const questions = screen.getByTestId('interactive-questions')
      expect(questions).toBeInTheDocument()
      expect(questions).toHaveAttribute('data-disabled', 'true')
      expect(screen.queryByTestId('tool-block-header')).not.toBeInTheDocument()
    })

    it('keeps the block header for a non-interactive tool', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult })

      expect(screen.getByTestId('tool-block-header')).toBeInTheDocument()
    })

    it('does not show an answered question as failed when the tool call reported an error', () => {
      renderToolBlock(
        { toolUse: askToolUse, toolResult: askErrorResult },
        { hasNextUserMessage: true, nextUserMessageIsFormResponse: true },
      )

      const block = screen.getByTestId('tool-block')
      expect(block).not.toHaveClass('tool-error')
      expect(block).toHaveAttribute('data-tool-status', 'completed')

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-is-error', 'false')
      expect(header).toHaveAttribute('data-was-answered', 'true')
    })

    it('does not leak the raw tool failure into the answered summary tooltip', () => {
      renderToolBlock(
        { toolUse: askToolUse, toolResult: askErrorResult },
        { hasNextUserMessage: true, nextUserMessageIsFormResponse: true },
      )

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute('data-summary', '')
    })

    it('does not show an unanswered question as failed when the tool call reported an error', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: askErrorResult })

      // The error is noise while the form is still the user's surface, not just once answered.
      const block = screen.getByTestId('tool-block')
      expect(block).not.toHaveClass('tool-error')
      expect(block).toHaveAttribute('data-tool-status', 'pending')
    })

    it('shows a bare form with no header for a live errored question', () => {
      renderToolBlock({ toolUse: askToolUse, toolResult: askErrorResult })

      expect(screen.queryByTestId('tool-block-header')).not.toBeInTheDocument()
      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()
    })

    it('answering an error-path question restores the header with an Answered summary', async () => {
      const user = userEvent.setup()

      renderToolBlock(
        { toolUse: askToolUse, toolResult: askErrorResult },
        { onFormSubmit: vi.fn() },
      )
      expect(screen.queryByTestId('tool-block-header')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('submit-answer'))

      const header = screen.getByTestId('tool-block-header')
      expect(header).toHaveAttribute('data-was-answered', 'true')
      expect(header).toHaveAttribute('data-is-error', 'false')
    })

    it('does not render expanded content (the error details) beneath a live errored form', () => {
      // A result exists here, so only the askUserAwaiting exclusion suppresses it.
      renderToolBlock({ toolUse: askToolUse, toolResult: askErrorResult })

      expect(screen.getByTestId('interactive-questions')).toBeInTheDocument()
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

  describe('streaming header hold', () => {
    it('shows only the tool name when a block is empty on first render', () => {
      const streamingToolUse = { content: 'Bash', tool_use_id: 'tu-stream', tool_input: {} }
      renderToolBlock({ toolUse: streamingToolUse, toolResult: null })

      // Exact match - not the "Bash(command)" generic-fallback placeholder.
      expect(screen.getByTestId('tool-block-header').textContent).toBe('Bash')
    })

    it('holds the previous header while tool_input goes empty mid-stream', async () => {
      const { rerender } = renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })
      expect(screen.getByTestId('tool-block-header')).toHaveTextContent('Bash(ls -la)')

      await act(async () => {
        rerenderToolBlock(rerender, {
          toolUse: { ...bashToolUse, tool_input: {} },
          toolResult: bashResult,
        })
      })

      // Never flashes back to the bare tool name once a real header was shown.
      expect(screen.getByTestId('tool-block-header')).toHaveTextContent('Bash(ls -la)')
    })

    it('adopts the computed header once input arrives', async () => {
      const streamingToolUse = { content: 'Bash', tool_use_id: 'tu-stream', tool_input: {} }
      const { rerender } = renderToolBlock({ toolUse: streamingToolUse, toolResult: null })
      expect(screen.getByTestId('tool-block-header')).toHaveTextContent('Bash')

      await act(async () => {
        rerenderToolBlock(rerender, {
          toolUse: { ...streamingToolUse, tool_input: { command: 'ls -la' } },
          toolResult: bashResult,
        })
      })

      expect(screen.getByTestId('tool-block-header')).toHaveTextContent('Bash(ls -la)')
    })

    it('does not carry a held header across a different tool_use_id', async () => {
      const { rerender } = renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })
      expect(screen.getByTestId('tool-block-header')).toHaveTextContent('Bash(ls -la)')

      await act(async () => {
        rerenderToolBlock(rerender, {
          toolUse: { content: 'Bash', tool_use_id: 'tu-other', tool_input: {} },
          toolResult: null,
        })
      })

      // Exact match - not the "Bash(command)" fallback placeholder, and not a stale hold
      // carried over from the previous tool_use_id.
      expect(screen.getByTestId('tool-block-header').textContent).toBe('Bash')
    })
  })

  describe('open-in-editor URL resolution', () => {
    const editTemplate = 'vscode://file/{path}:{line}'

    it('resolves editorUrl for a Read block when a template is configured', () => {
      useEditorTemplate.mockReturnValue(editTemplate)
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult })

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute(
        'data-editor-url',
        'vscode://file/%2Fsrc%2Fapp.js:1',
      )
    })

    it('resolves editorUrl for Edit and Write blocks', () => {
      useEditorTemplate.mockReturnValue(editTemplate)
      const editToolUse = {
        content: 'Edit',
        tool_use_id: 'tu-edit',
        tool_input: { file_path: '/src/edit.js' },
      }
      renderToolBlock({ toolUse: editToolUse, toolResult: { content: 'ok' } })

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute(
        'data-editor-url',
        'vscode://file/%2Fsrc%2Fedit.js:1',
      )
    })

    it("uses the Read call's starting offset as the line when present", () => {
      useEditorTemplate.mockReturnValue(editTemplate)
      renderToolBlock({
        toolUse: {
          ...readToolUse,
          tool_input: { ...readToolUse.tool_input, offset: 42 },
        },
        toolResult: readResult,
      })

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute(
        'data-editor-url',
        'vscode://file/%2Fsrc%2Fapp.js:42',
      )
    })

    it("ignores Edit's diff-match source_offset - the line always resolves to 1", () => {
      useEditorTemplate.mockReturnValue(editTemplate)
      const editToolUse = {
        content: 'Edit',
        tool_use_id: 'tu-edit',
        tool_input: { file_path: '/src/edit.js' },
        source_offset: 42,
      }
      renderToolBlock({ toolUse: editToolUse, toolResult: { content: 'ok' } })

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute(
        'data-editor-url',
        'vscode://file/%2Fsrc%2Fedit.js:1',
      )
    })

    it('leaves editorUrl empty for a tool with no file_path', () => {
      useEditorTemplate.mockReturnValue(editTemplate)
      renderToolBlock({ toolUse: bashToolUse, toolResult: bashResult })

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute('data-editor-url', '')
    })

    it('leaves editorUrl empty when no template is configured', () => {
      renderToolBlock({ toolUse: readToolUse, toolResult: readResult })

      expect(screen.getByTestId('tool-block-header')).toHaveAttribute('data-editor-url', '')
    })
  })
})
