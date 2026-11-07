/** TUI-style tool use and result block with expandable content. */

import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'
import { useEffect, useMemo, useRef, useState } from 'react'
import { normalizeToolName, ToolName } from '../../../../../../config/schema'
import { isReadOnlyCommand } from '../../../../../../config/toolRegistry'
import useCapabilities from '../../../../../../hooks/useCapabilities'
import useEditorTemplate from '../../../../../../hooks/useEditorTemplate'
import { resolveEditorUrl } from '../../../../../../utils/editorUrl'
import { isInteractiveTool } from '../../../../../../utils/eventPredicates'
import { processNestedEvents, reminderEntries } from '../../../../../../utils/eventProcessing'
import { useFocusedMarks } from '../../hooks/useFocusedMarks'
import { useTurn } from '../../hooks/useTurn'
import { useTurnRoutingMode } from '../../hooks/useTurnRoutingMode'
import InteractiveQuestions from './components/interactive-questions'
import PortRequestCard from './components/PortRequestCard'
import ToolBlockHeader from './components/ToolBlockHeader'
import CollapsibleSection from './components/tool-block-expanded-content/components/CollapsibleSection'
import ToolBlockExpandedContent from './components/tool-block-expanded-content/ToolBlockExpandedContent'
import useHideInFocused from './hooks/useHideInFocused'
import useInteractiveState from './hooks/useInteractiveState'
import useToolBookmark from './hooks/useToolBookmark'
import useToolResult from './hooks/useToolResult'
import { parseAnswerLabel } from './utils/answerLabel'
import { PLAN_REVIEW_QUESTIONS } from './utils/constants'
import {
  computeLiveBlockDuration,
  hasExpandableContent,
  isAskUserAwaitingAnswer,
  isPlanAwaitingAnswer,
  isSingleLineDuplicate,
  shouldStartCollapsed,
} from './utils/toolBlockState'
import {
  buildToolHeader,
  fetchedPageUrl,
  getToolStatus,
  getToolTooltip,
  hasSpecializedFormatter,
} from './utils/toolResultFormatters'

// Tools whose input carries a file_path - eligible for the "open in editor" affordance.
const EDITOR_TOOLS = new Set([ToolName.READ, ToolName.EDIT, ToolName.WRITE])

/**
 * Consumes TurnContext for turn-scoped data.
 * @param {Object} props.toolUse - content, tool_use_id, tool_input.
 * @param {Object} [props.toolResult] - content string.
 * @param {Array} [props.nestedEvents] - Nested events for Task tools.
 * @param {Object} [props.todoDiff] - Todo diff for TodoWrite tool.
 * @param {number} [props.blockRelativeTime] - Precomputed offset from turn start, in seconds.
 * @param {Array} [props.injected] - Text the agent received after this call that no one wrote.
 */
export default function ToolBlock({
  toolUse,
  toolResult,
  nestedEvents,
  skillContent,
  todoDiff = null,
  nested = false,
  blockRelativeTime = null,
  injected = null,
}) {
  const { hasPendingMessages, onFormSubmit, registerPendingForm, now, isActiveTurn } = useTurn()
  const { capabilities } = useCapabilities()
  // Absent/undefined supports_ask_user_question counts as enabled - back-compat for fixtures/pre-init races.
  const askUserQuestionEnabled = capabilities?.supports_ask_user_question !== false

  const [showDetails, setShowDetails] = useState(null) // null = use default

  // LangGraph's snake_case maps to Claude's canonical form for comparisons (schema.js::TOOL_NAME_ALIASES).
  const toolName = normalizeToolName(toolUse?.content || 'Tool')
  const rawInput = toolUse?.tool_input ?? {}

  // Field shape is whatever the model or tool server produced - checked once here, so no
  // downstream reader needs its own guard; the list grows if a fifth field turns up crashing.
  const malformedFields = [
    rawInput.questions !== undefined && !Array.isArray(rawInput.questions) ? 'questions' : null,
    rawInput.plan !== undefined && typeof rawInput.plan !== 'string' ? 'plan' : null,
    rawInput.prompt !== undefined && typeof rawInput.prompt !== 'string' ? 'prompt' : null,
  ].filter(Boolean)
  const isMalformed = malformedFields.length > 0
  const input = isMalformed
    ? { ...rawInput, questions: undefined, plan: undefined, prompt: undefined }
    : rawInput
  const safeToolUse = isMalformed ? { ...toolUse, tool_input: input } : toolUse

  const toolUseId = toolUse?.tool_use_id ?? null
  const filePath = input?.file_path || null
  const sourceUrl = fetchedPageUrl(toolName, input)
  const outputMode = input?.output_mode || null
  const lineOffset = toolUse?.source_offset ?? null
  const tooltip = getToolTooltip(toolName, input)

  // Editor URL resolved once here, not per header/Lookups row; line hint is Read's offset input,
  // null for Edit/Write - distinct from `lineOffset` above (diff-match line for the expanded gutter).
  const editorTemplate = useEditorTemplate()
  const editorLineHint = toolName === ToolName.READ ? (input?.offset ?? null) : null
  const editorUrl =
    EDITOR_TOOLS.has(toolName) && filePath
      ? resolveEditorUrl(editorTemplate, { path: filePath, line: editorLineHint })
      : null

  // Extract tool result state (consumes TurnContext for taskNotifications)
  const {
    questions,
    plan,
    todoData,
    taskPrompt,
    systemReminders,
    persistedOutput,
    effectiveSummary,
    effectiveIsError,
    effectiveIsPending,
    effectiveDetails,
    taskNotification,
    isTaskOutputKilled,
    isAsyncTask,
    isPending,
    jsonData,
    contentBlocks,
  } = useToolResult(safeToolUse, toolResult, todoDiff)

  // Whether a form can actually render - independent of what the runtime reported for the call.
  const canRenderForm =
    toolName === ToolName.ASK_USER_QUESTION && askUserQuestionEnabled && input.questions?.length > 0

  // Track interactive answer state (consumes TurnContext for message state)
  const {
    wasAnswered,
    isAwaitingAnswer,
    wasSkipped,
    answerLabel,
    wasAnsweredLocally,
    setWasAnsweredLocally,
    setLocalAnswerLabel,
  } = useInteractiveState(toolName, canRenderForm, plan)

  const askUserAwaiting = isAskUserAwaitingAnswer(toolName, canRenderForm, wasAnswered)
  const pendingQuestions = askUserAwaiting ? input.questions : null

  // ExitPlanMode awaits response when plan is present and not yet answered
  const planAwaiting = isPlanAwaitingAnswer(toolName, plan, wasAnswered)

  const addedEntries = useMemo(
    () => [...reminderEntries(systemReminders ?? []), ...(injected ?? [])],
    [systemReminders, injected],
  )

  // Process nested events for Task; the Activity section leaves out what the view hides
  const routingMode = useTurnRoutingMode()
  const { isMarked } = useFocusedMarks()
  const allNestedBlocks = useMemo(() => processNestedEvents(nestedEvents), [nestedEvents])
  const nestedBlocks = useMemo(
    () => processNestedEvents(nestedEvents, routingMode, isMarked),
    [nestedEvents, routingMode, isMarked],
  )
  const hasNested = allNestedBlocks.length > 0

  // A collapsed, still-running Task's one line: the newest nested entry, hidden kinds included,
  // drawn the way the Activity section would. Empty for every other tool - only a Task has one.
  const lastNestedBlock = hasNested ? allNestedBlocks[allNestedBlocks.length - 1] : null
  const activity = useMemo(() => {
    if (!lastNestedBlock) {
      return null
    }
    if (lastNestedBlock.kind === 'text') {
      return { kind: 'text', text: lastNestedBlock.event.content.split('\n')[0] }
    }
    const nestedToolName = normalizeToolName(lastNestedBlock.toolUse?.content || 'Tool')
    return {
      kind: 'call',
      status: getToolStatus(
        !lastNestedBlock.toolResult,
        false,
        lastNestedBlock.toolResult?.is_error,
      ),
      title: buildToolHeader(nestedToolName, lastNestedBlock.toolUse?.tool_input ?? {}, false),
    }
  }, [lastNestedBlock])

  // tool_input for unhandled tools - null for handled tools (they render their own way)
  const toolInput =
    !hasSpecializedFormatter(toolName) && Object.keys(input).length > 0 ? input : null

  // Bash's command - the one payload a pending Bash shows; derived once, read at both expandability gates below.
  const bashCommand = toolName === ToolName.BASH ? (input?.command ?? null) : null

  const singleLineDuplicate = isSingleLineDuplicate(effectiveDetails, effectiveSummary)

  const hasExpandable = hasExpandableContent({
    effectiveDetails,
    jsonData,
    contentBlocks,
    hasNested,
    skillContent,
    questions,
    plan,
    pendingQuestions,
    todoData,
    taskPrompt,
    persistedOutput,
    toolInput,
    command: bashCommand,
  })
  // Default: per-tool defaults, a no-change Bash, and any other tool's one-line dupe of its summary
  const collapseByDefault = shouldStartCollapsed({
    toolName,
    readOnlyCommand: isReadOnlyCommand(toolUse, toolResult),
    singleLineDuplicate,
    jsonData,
    contentBlocks,
    hasNested,
    isPending,
    wasAnswered,
  })
  const effectiveShowDetails = showDetails !== null ? showDetails : !collapseByDefault

  // Imperative handle onto the live AskUserQuestion form - see the registerPendingForm effect below.
  const formRef = useRef(null)

  // Header: tool name with args, full path when expanded for file tools; held per tool_use_id
  // while input is empty so it never flashes the generic fallback before input arrives.
  const hasInput = Object.keys(input).length > 0
  const headerHoldRef = useRef({ toolUseId: null, header: null })
  let header
  if (hasInput) {
    header = buildToolHeader(toolName, input, effectiveShowDetails)
    headerHoldRef.current = { toolUseId, header }
  } else if (headerHoldRef.current.toolUseId === toolUseId) {
    header = headerHoldRef.current.header
  } else {
    header = toolName
  }

  // Auto-collapse when Task completes (isPending transitions false)
  const prevPendingRef = useRef(isPending)
  useEffect(() => {
    if (prevPendingRef.current && !isPending && (hasNested || isAsyncTask)) {
      // Was pending, now complete - collapse
      setShowDetails(false)
    }
    prevPendingRef.current = isPending
  }, [isPending, hasNested, isAsyncTask])

  const handleToggle = () => hasExpandable && setShowDetails(!effectiveShowDetails)

  const bookmark = useToolBookmark(toolUse, () =>
    hasInput ? buildToolHeader(toolName, input, false) : toolName,
  )
  const hideInFocused = useHideInFocused(toolUse)

  const isReadOnly = !onFormSubmit
  const formDisabled = isReadOnly || wasAnswered || hasPendingMessages

  // Named so the block chrome can be gated on the same condition that decides the form
  const showQuestionForm =
    canRenderForm && effectiveShowDetails && !(wasAnsweredLocally && hasPendingMessages)

  // A live form repeats the header; every other state needs it for the summary and as the collapse target.
  const showHeader = !(showQuestionForm && askUserAwaiting)

  // Registers the live form so Enter in the composer can submit without owning selection state.
  // Only one turn awaits an answer, so a later mount safely overwrites an earlier one.
  useEffect(() => {
    if (!(showQuestionForm && askUserAwaiting)) {
      return undefined
    }
    registerPendingForm?.({
      hasSelection: () => formRef.current?.hasSelection ?? false,
      submit: () => formRef.current?.submit(),
    })
    return () => registerPendingForm?.(null)
  }, [showQuestionForm, askUserAwaiting, registerPendingForm])

  // Runtime tool-unavailable reports are noise here - a form (past or present) is what the user actually sees.
  const answeredInteractive = isInteractiveTool(toolName) && wasAnswered
  const displayIsError = effectiveIsError && !answeredInteractive && !askUserAwaiting

  // Block timing: live duration for pending blocks (>= 30s threshold)
  const toolUseTime = toolUse?.ts ? new Date(toolUse.ts).getTime() : null
  const toolResultTime = toolResult?.ts ? new Date(toolResult.ts).getTime() : null

  const blockDuration = useMemo(
    () =>
      computeLiveBlockDuration({
        isAsyncTask,
        toolUseTime,
        toolResultTime,
        isActiveTurn,
        now,
      }),
    [isAsyncTask, toolUseTime, toolResultTime, isActiveTurn, now],
  )

  if (isMalformed) {
    return (
      <div
        className={`tool-block ${nested ? 'nested' : ''} tool-error`}
        data-testid="tool-block"
        data-tool-use-id={toolUseId}
        data-tool-status="error">
        <ToolBlockHeader
          header={toolName}
          toolName={toolName}
          tooltip={null}
          summary="This tool call could not be read"
          hasExpandable
          onToggle={() => setShowDetails(!effectiveShowDetails)}
          injected={addedEntries}
          toolStatus={{
            isPending: false,
            isAwaitingAnswer: false,
            wasAnswered: false,
            isError: true,
          }}
        />
        {effectiveShowDetails && (
          <CollapsibleSection label="Input" defaultExpanded className="tool-input-section">
            <div className="tool-json">
              <JsonView
                value={rawInput}
                style={darkTheme}
                collapsed={false}
                displayDataTypes={false}
                displayObjectSize={false}
                shortenTextAfterLength={200}
              />
            </div>
          </CollapsibleSection>
        )}
      </div>
    )
  }

  return (
    <div
      className={`tool-block ${nested ? 'nested' : ''} ${displayIsError ? 'tool-error' : ''}${bookmark?.active ? ' bookmarked' : ''}`}
      data-testid="tool-block"
      data-tool-use-id={toolUseId}
      data-expanded={hasExpandable ? String(effectiveShowDetails) : undefined}
      data-tool-status={getToolStatus(effectiveIsPending, isAwaitingAnswer, displayIsError)}>
      {showHeader && (
        <ToolBlockHeader
          header={header}
          toolName={toolName}
          tooltip={tooltip}
          summary={answeredInteractive ? '' : effectiveSummary}
          hasExpandable={hasExpandable}
          onToggle={handleToggle}
          editorUrl={editorUrl}
          bookmark={bookmark}
          hideInFocused={hideInFocused}
          activity={effectiveShowDetails ? null : activity}
          injected={addedEntries}
          toolStatus={{
            isPending: effectiveIsPending,
            isAwaitingAnswer,
            wasAnswered,
            wasSkipped,
            isError: displayIsError,
            answerLabel,
            taskNotification,
            isTaskOutputKilled,
            blockDuration: effectiveIsPending ? blockDuration : null,
            blockRelativeTime: effectiveIsPending ? null : blockRelativeTime,
            blockTime: effectiveIsPending ? null : (toolResultTime ?? toolUseTime),
          }}
        />
      )}

      {/* Interactive questions for AskUserQuestion - hidden during pending state after local submit (Q/A bubble shows instead) and gated on the runtime's supports_ask_user_question capability. */}
      {showQuestionForm && (
        <InteractiveQuestions
          ref={formRef}
          questions={input.questions}
          disabled={formDisabled}
          onSubmit={answer => {
            setWasAnsweredLocally(true)
            setShowDetails(false) // Auto-collapse on submit
            onFormSubmit(answer)
          }}
        />
      )}

      <PortRequestCard toolName={toolName} port={input.port} toolResult={toolResult} />

      {/* Expanded content: completed tools, pending Task (nested streams in), unhandled tools */}
      {/* with input, or a pending Bash with a command to show. */}
      {(!isPending || toolName === ToolName.TASK || toolInput || bashCommand) &&
        effectiveShowDetails &&
        !(toolName === ToolName.ASK_USER_QUESTION && (wasAnswered || askUserAwaiting)) && (
          <ToolBlockExpandedContent
            toolName={toolName}
            filePath={filePath}
            outputMode={outputMode}
            command={bashCommand}
            contentData={{
              details: effectiveDetails,
              jsonData,
              contentBlocks,
              skillContent,
              questions,
              plan,
              todoData,
              taskPrompt,
              persistedOutput,
              sourceUrl,
              commandLayout: toolUse?.command_layout ?? null,
            }}
            toolInput={toolInput}
            nestedBlocks={nestedBlocks}
            todoDiff={todoDiff}
            toolUseId={toolUseId}
            lineOffset={lineOffset}
          />
        )}

      {/* Plan approve/reject for ExitPlanMode - rendered after plan content */}
      {planAwaiting && effectiveShowDetails && !(wasAnsweredLocally && hasPendingMessages) && (
        <InteractiveQuestions
          questions={PLAN_REVIEW_QUESTIONS}
          responseTag="ExitPlanMode"
          disabled={formDisabled}
          onSubmit={answer => {
            const label = parseAnswerLabel(answer)
            if (label) {
              setLocalAnswerLabel(label)
            }
            setWasAnsweredLocally(true)
            setShowDetails(false)
            onFormSubmit(answer)
          }}
        />
      )}
    </div>
  )
}
