/** Tests for ToolBlockExpandedContent. */

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TurnProvider } from '../../../../TurnContext'
import ToolBlockExpandedContent from './ToolBlockExpandedContent'

// Mock heavy external libraries and API-boundary components
vi.mock('../../../../../../../../components/Markdown', () => ({
  default: ({ children }) => <div data-testid="markdown">{children}</div>,
}))

vi.mock('./components/NestedToolWrapper', () => ({
  default: ({ toolUse }) => <div data-testid="nested-tool">{toolUse?.name || 'nested'}</div>,
}))

vi.mock('./components/tool-content-renderer', () => ({
  default: ({ toolName, details }) => (
    <div data-testid="tool-content-renderer">
      {toolName}: {details}
    </div>
  ),
}))

vi.mock('./components/PersistedOutputContent', () => ({
  default: ({ preview, toolUseId }) => (
    <div data-testid="persisted-output">
      {preview} (id: {toolUseId})
    </div>
  ),
}))

vi.mock('@uiw/react-json-view', () => ({
  default: ({ value }) => <div data-testid="json-view">{JSON.stringify(value)}</div>,
}))

vi.mock('@uiw/react-json-view/dark', () => ({
  darkTheme: {},
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

/** Render ToolBlockExpandedContent wrapped in TurnProvider. */
function renderExpanded(props, contextOverrides = {}) {
  const turnProps = { ...defaultTurnContext, ...contextOverrides }
  return render(
    <TurnProvider {...turnProps}>
      <ToolBlockExpandedContent {...props} />
    </TurnProvider>,
  )
}

describe('ToolBlockExpandedContent', () => {
  const defaultContentData = {
    details: 'file contents here',
    jsonData: null,
    skillContent: null,
    questions: null,
    pendingQuestions: false,
    plan: null,
    todoData: null,
    taskPrompt: null,
    systemReminders: null,
    persistedOutput: null,
  }

  const defaultProps = {
    toolName: 'Read',
    filePath: '/test/file.txt',
    outputMode: null,
    contentData: defaultContentData,
    nestedBlocks: [],
    todoDiff: null,
    toolUseId: 'tool-1',
  }

  it('renders ToolContentRenderer for non-Task tools with details', () => {
    renderExpanded(defaultProps)

    expect(screen.getByTestId('tool-content-renderer')).toBeInTheDocument()
    expect(screen.getByTestId('tool-content-renderer')).toHaveTextContent(
      'Read: file contents here',
    )
  })

  it('does not render ToolContentRenderer for Task tools', () => {
    renderExpanded({
      ...defaultProps,
      toolName: 'Task',
      contentData: { ...defaultContentData, details: 'result' },
    })

    expect(screen.queryByTestId('tool-content-renderer')).not.toBeInTheDocument()
  })

  it('renders TaskResult for Task tools with details', () => {
    renderExpanded({
      ...defaultProps,
      toolName: 'Task',
      contentData: { ...defaultContentData, details: 'task result' },
    })

    // Real TaskResult renders "Result" label with defaultExpanded=true showing content
    expect(screen.getByText('Result')).toBeInTheDocument()
    expect(screen.getByText('task result')).toBeInTheDocument()
  })

  it('does not render TaskResult for non-Task tools', () => {
    renderExpanded(defaultProps)

    expect(screen.queryByText('Result')).not.toBeInTheDocument()
  })

  it('renders PersistedOutputContent when persistedOutput is provided', () => {
    renderExpanded({
      ...defaultProps,
      contentData: {
        ...defaultContentData,
        persistedOutput: { fileSize: 1000, previewSize: 500 },
      },
    })

    expect(screen.getByTestId('persisted-output')).toBeInTheDocument()
  })

  it('hides ToolContentRenderer when persistedOutput is provided', () => {
    renderExpanded({
      ...defaultProps,
      contentData: {
        ...defaultContentData,
        persistedOutput: { fileSize: 1000, previewSize: 500 },
      },
    })

    expect(screen.queryByTestId('tool-content-renderer')).not.toBeInTheDocument()
  })

  it('renders TaskPrompt when taskPrompt is provided', () => {
    renderExpanded({
      ...defaultProps,
      toolName: 'Task',
      contentData: { ...defaultContentData, taskPrompt: 'Do this task' },
    })

    // Real TaskPrompt renders "Prompt" label; defaultExpanded=true shows content via Markdown
    expect(screen.getByText('Prompt')).toBeInTheDocument()
    expect(screen.getByText('Do this task')).toBeInTheDocument()
  })

  it('does not render TaskPrompt when taskPrompt is null', () => {
    renderExpanded(defaultProps)

    expect(screen.queryByText('Prompt')).not.toBeInTheDocument()
  })

  it('renders nested blocks inside Activity collapsible section', () => {
    const nestedBlocks = [
      { toolUse: { name: 'Read' }, toolResult: {} },
      { toolUse: { name: 'Write' }, toolResult: {} },
    ]

    renderExpanded({ ...defaultProps, nestedBlocks })

    expect(screen.getByText('Activity')).toBeInTheDocument()
    const nested = screen.getAllByTestId('nested-tool')
    expect(nested).toHaveLength(2)
  })

  it('hides nested blocks when Activity section is collapsed', () => {
    const nestedBlocks = [
      { toolUse: { name: 'Read' }, toolResult: {} },
      { toolUse: { name: 'Write' }, toolResult: {} },
    ]

    renderExpanded({ ...defaultProps, nestedBlocks })

    // Activity starts expanded by default
    expect(screen.getAllByTestId('nested-tool')).toHaveLength(2)

    // Collapse Activity
    fireEvent.click(screen.getByText('Activity'))
    expect(screen.queryByTestId('nested-tool')).not.toBeInTheDocument()
  })

  it('does not render Activity section when nestedBlocks is empty', () => {
    renderExpanded(defaultProps)

    expect(screen.queryByText('Activity')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nested-tool')).not.toBeInTheDocument()
  })

  it('renders QuestionsDisplay when questions exist and not pending', () => {
    const questions = [
      { header: 'Auth', question: 'Which method?', options: [{ label: 'OAuth' }] },
      { header: 'DB', question: 'Which database?', options: [{ label: 'Postgres' }] },
    ]

    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, questions, pendingQuestions: false },
    })

    // Real QuestionsDisplay renders QuestionCard with header and question text
    expect(screen.getByText('Auth')).toBeInTheDocument()
    expect(screen.getByText('Which method?')).toBeInTheDocument()
    expect(screen.getByText('DB')).toBeInTheDocument()
  })

  it('does not render QuestionsDisplay when questions are pending', () => {
    const questions = [{ header: 'Auth', question: 'Which method?', options: [{ label: 'OAuth' }] }]

    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, questions, pendingQuestions: true },
    })

    expect(screen.queryByText('Which method?')).not.toBeInTheDocument()
  })

  it('does not render QuestionsDisplay when questions is empty', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, questions: [] },
    })

    expect(document.querySelector('.tool-questions')).not.toBeInTheDocument()
  })

  it('renders plan as Markdown when provided', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, plan: '## Plan\n- Step 1' },
    })

    const planDiv = document.querySelector('.tool-plan')
    expect(planDiv).toBeInTheDocument()
    expect(planDiv.textContent).toContain('## Plan')
  })

  it('applies turn-text class to plan container for assistant message styling', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, plan: '## Plan' },
    })

    const planDiv = document.querySelector('.tool-plan')
    expect(planDiv).toHaveClass('turn-text')
  })

  it('does not render plan section when plan is null', () => {
    renderExpanded(defaultProps)

    expect(document.querySelector('.tool-plan')).not.toBeInTheDocument()
  })

  it('renders TodoList when todoData is non-empty', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, todoData: [{ content: 'Fix the bug' }] },
    })

    // Real TodoList renders todo items with pending icon and content text
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('○')).toBeInTheDocument()
  })

  it('does not render TodoList when todoData is empty', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, todoData: [] },
    })

    expect(document.querySelector('.todo-list')).not.toBeInTheDocument()
  })

  it('does not render TodoList when todoData is null', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, todoData: null },
    })

    expect(document.querySelector('.todo-list')).not.toBeInTheDocument()
  })

  it('renders SystemReminders when reminders exist', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, systemReminders: ['reminder1', 'reminder2'] },
    })

    // Real SystemReminders renders collapsed button with count
    expect(screen.getByText('System Reminders (2)')).toBeInTheDocument()
  })

  it('does not render SystemReminders when empty', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, systemReminders: [] },
    })

    expect(screen.queryByText(/System Reminder/)).not.toBeInTheDocument()
  })

  it('renders skillContent as Markdown when provided', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, skillContent: '# Skill output' },
    })

    const skillDiv = document.querySelector('.tool-skill-content')
    expect(skillDiv).toBeInTheDocument()
  })

  it('applies turn-text class to skill content container for assistant message styling', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, skillContent: '# Skill output' },
    })

    const skillDiv = document.querySelector('.tool-skill-content')
    expect(skillDiv).toHaveClass('turn-text')
  })

  it('does not render skill section when skillContent is null', () => {
    renderExpanded(defaultProps)

    expect(document.querySelector('.tool-skill-content')).not.toBeInTheDocument()
  })

  it('renders tool input in collapsible section when toolInput is provided', () => {
    const toolInput = { collection_name: 'share', query_texts: ['test query'] }
    renderExpanded({ ...defaultProps, toolName: 'mcp__chroma__query', toolInput })

    expect(screen.getByText('Input')).toBeInTheDocument()
    const jsonViews = screen.getAllByTestId('json-view')
    expect(jsonViews[0]).toHaveTextContent(JSON.stringify(toolInput))
  })

  it('does not render tool input section when toolInput is null', () => {
    renderExpanded(defaultProps)

    expect(screen.queryByText('Input')).not.toBeInTheDocument()
  })

  it('renders tool input above tool output', () => {
    const toolInput = { query: 'test' }
    renderExpanded({
      ...defaultProps,
      toolName: 'mcp__unknown__tool',
      toolInput,
      contentData: { ...defaultContentData, details: 'output text' },
    })

    const expandedContent = document.querySelector('.tool-expanded-content')
    const inputSection = expandedContent.querySelector('.tool-input-section')
    const outputSection = expandedContent.querySelector('.tool-output-section')
    // Input section should appear before output in DOM order
    expect(inputSection.compareDocumentPosition(outputSection)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it('wraps output in collapsible Output section for unhandled tools', () => {
    const toolInput = { query: 'test' }
    renderExpanded({
      ...defaultProps,
      toolName: 'mcp__unknown__tool',
      toolInput,
      contentData: { ...defaultContentData, jsonData: { key: 'value' } },
    })

    expect(screen.getByText('Output')).toBeInTheDocument()
    const outputSection = document.querySelector('.tool-output-section')
    expect(outputSection).toBeInTheDocument()
  })

  it('does not wrap output in Output section for handled tools', () => {
    renderExpanded(defaultProps)

    expect(screen.queryByText('Output')).not.toBeInTheDocument()
    expect(document.querySelector('.tool-output-section')).not.toBeInTheDocument()
  })

  it('renders JsonView for non-Task tools when jsonData is provided', () => {
    renderExpanded({
      ...defaultProps,
      contentData: { ...defaultContentData, jsonData: { key: 'value' } },
    })

    expect(screen.getByTestId('json-view')).toBeInTheDocument()
  })

  it('does not render JsonView for Task tools even with jsonData', () => {
    renderExpanded({
      ...defaultProps,
      toolName: 'Task',
      contentData: { ...defaultContentData, jsonData: { key: 'value' } },
    })

    expect(screen.queryByTestId('json-view')).not.toBeInTheDocument()
  })
})
