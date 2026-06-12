/** Expanded content section for ToolBlock. */

import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'
import { useMemo } from 'react'
import Markdown from '../../../../../../../../components/Markdown'
import { computeTimingOffsets } from '../../../../../../../../utils/eventProcessing'
import { hasDiffItems } from '../../../../../../../../utils/todoDiff'
import { useTurn } from '../../../../hooks/useTurn'
import SystemReminders from '../../../SystemReminders'
import CollapsibleSection from './components/CollapsibleSection'
import NestedContent from './components/NestedContent'
import NestedToolWrapper from './components/NestedToolWrapper'
import PersistedOutputContent from './components/PersistedOutputContent'
import QuestionsDisplay from './components/QuestionsDisplay'
import TaskPrompt from './components/TaskPrompt'
import TaskResult from './components/TaskResult'
import TodoList from './components/TodoList'
import ToolContentRenderer from './components/tool-content-renderer'

/**
 * Render the expanded content section of a ToolBlock.
 * Consumes TurnContext for turnStartTime, now, isActiveTurn, todoDiffs.
 * @param {Object} props
 * @param {string} props.toolName - Name of the tool (e.g., 'Task', 'Read').
 * @param {string} [props.filePath] - File path for file-based tools.
 * @param {string} [props.outputMode] - Output mode for content renderer.
 * @param {Object} props.contentData - Grouped content data object.
 * @param {string} [props.contentData.details] - Details or result text to display.
 * @param {Object} [props.contentData.jsonData] - JSON data to render in a viewer.
 * @param {string} [props.contentData.skillContent] - Skill markdown content.
 * @param {Array} [props.contentData.questions] - Answered questions to display.
 * @param {Array} [props.contentData.pendingQuestions] - Questions awaiting user response.
 * @param {string} [props.contentData.plan] - Plan markdown content.
 * @param {Array} [props.contentData.todoData] - Todo items to display.
 * @param {string} [props.contentData.taskPrompt] - Task prompt text.
 * @param {Array} [props.contentData.systemReminders] - System reminder strings.
 * @param {Object} [props.contentData.persistedOutput] - Persisted output info with fileSize and previewSize.
 * @param {Object} [props.toolInput] - Raw tool input for unhandled tools (null for handled tools).
 * @param {Array} props.nestedBlocks - Array of nested tool use/result pairs.
 * @param {Object} [props.todoDiff] - Diff object for todo changes.
 * @param {string} [props.toolUseId] - Tool use ID for persisted output lookup.
 * @param {number} [props.lineOffset] - Starting line number for Edit tool diffs.
 */
export default function ToolBlockExpandedContent({
  toolName,
  filePath,
  outputMode = null,
  contentData,
  toolInput = null,
  nestedBlocks,
  todoDiff,
  toolUseId,
  lineOffset = null,
}) {
  const { turnStartTime } = useTurn()

  const {
    details,
    jsonData,
    skillContent,
    questions,
    pendingQuestions,
    plan,
    todoData,
    taskPrompt,
    systemReminders,
    persistedOutput,
  } = contentData

  const hasNested = nestedBlocks.length > 0
  const showQuestions = questions && questions.length > 0 && !pendingQuestions
  const isTask = toolName === 'Task'

  // Precompute threshold-filtered timing offsets for nested blocks
  const nestedOffsets = useMemo(() => {
    const timestamps = nestedBlocks.map(b => b.toolResult?.ts || b.toolUse?.ts)
    return computeTimingOffsets(timestamps, turnStartTime)
  }, [nestedBlocks, turnStartTime])

  return (
    <div className="tool-expanded-content">
      {/* Task: prompt expanded by default at top */}
      {taskPrompt && <TaskPrompt prompt={taskPrompt} defaultExpanded />}

      {persistedOutput && (
        <PersistedOutputContent
          preview={details}
          toolUseId={toolUseId}
          fileSize={persistedOutput.fileSize}
          previewSize={persistedOutput.previewSize}
        />
      )}

      {/* Tool input for unhandled tools - shown above output */}
      {toolInput && (
        <CollapsibleSection label="Input" defaultExpanded className="tool-input-section">
          <div className="tool-json">
            <JsonView
              value={toolInput}
              style={darkTheme}
              collapsed={false}
              displayDataTypes={false}
              displayObjectSize={false}
              shortenTextAfterLength={200}
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Non-Task output: collapsible Output wrapper for unhandled tools, plain for handled */}
      {(() => {
        const outputContent = (
          <>
            {!(isTask || persistedOutput) && (
              <ToolContentRenderer
                toolName={toolName}
                details={details}
                filePath={filePath}
                outputMode={outputMode}
                lineOffset={lineOffset}
              />
            )}
            {!isTask && jsonData && (
              <div className="tool-json">
                <JsonView
                  value={jsonData}
                  style={darkTheme}
                  collapsed={false}
                  displayDataTypes={false}
                  displayObjectSize={false}
                />
              </div>
            )}
          </>
        )
        if (toolInput && (details || jsonData)) {
          return (
            <CollapsibleSection label="Output" defaultExpanded className="tool-output-section">
              {outputContent}
            </CollapsibleSection>
          )
        }
        return outputContent
      })()}

      {/* Task: nested blocks in collapsible Activity section */}
      {hasNested && (
        <CollapsibleSection label="Activity" defaultExpanded className="task-activity">
          <NestedContent className="tool-nested">
            {nestedBlocks.map((block, i) => (
              <NestedToolWrapper
                key={i}
                toolUse={block.toolUse}
                toolResult={block.toolResult}
                blockRelativeTime={nestedOffsets[i]}
              />
            ))}
          </NestedContent>
        </CollapsibleSection>
      )}

      {/* Task: result at end (same level as prompt) */}
      {isTask && details && <TaskResult result={details} defaultExpanded />}

      {skillContent && (
        <div className="tool-skill-content turn-text">
          <Markdown>{skillContent}</Markdown>
        </div>
      )}

      {showQuestions && <QuestionsDisplay questions={questions} />}

      {plan && (
        <div className="tool-plan turn-text">
          <Markdown>{plan}</Markdown>
        </div>
      )}

      {/* TaskCreate / TaskUpdate route to the same TodoList renderer fed by
          appendTaskDiffs; their formatters do not populate todoData, so a
          non-empty todoDiff also gates rendering. */}
      {((todoData && todoData.length > 0) || hasDiffItems(todoDiff)) && (
        <TodoList todos={todoData} todoDiff={todoDiff} />
      )}

      {systemReminders && systemReminders.length > 0 && (
        <SystemReminders reminders={systemReminders} />
      )}
    </div>
  )
}
