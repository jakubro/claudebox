/** Footer status bar showing session info. */

import { STATUS_PAGE_URL } from '../../config/urls'
import { useEvents } from '../../context/EventsContext'
import { useInteraction } from '../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../context/SessionDataContext'
import useCapabilities from '../../hooks/useCapabilities'
import useCopyFlash from '../../hooks/useCopyFlash'
import useCurrentBackendId from '../../hooks/useCurrentBackendId'
import useSessionDefaults from '../../hooks/useSessionDefaults'
import { getContextBarColor } from '../../utils/color'
import { computeContextBar } from '../../utils/contextBar'
import { formatDurationClock, getWorkspaceName } from '../../utils/formatters'
import { formatSessionDirTooltip } from '../../utils/session'
import EffortLevelPicker from './components/EffortLevelPicker'
import ModelPicker from './components/ModelPicker'
import PermissionModePicker from './components/PermissionModePicker'
import RuntimeIdentityPill from './components/RuntimeIdentityPill'
import StatusIndicator from './components/status-indicator'
import useClaudeStatus from './hooks/useClaudeStatus'

/**
 * Render footer status bar with session metrics and controls.
 *
 * Display workspace, turns, cost, duration, context usage, model, session ID,
 * notifications toggle, and Claude API status indicator.
 */
export default function Footer() {
  const {
    connectionStatus,
    connectionError,
    isResponding,
    respondingSince,
    lastEventTimestamp,
    isResuming,
    isReplaying,
    isCreating,
    isForking,
    isOpeningBoard,
    isOpeningWorkspace,
  } = useEvents()

  const {
    model,
    permissionMode,
    effortLevel,
    workspace,
    numTurns,
    totalCostUsd,
    totalDurationMs,
    lastContextTokens,
    contextWindow,
    sessionId,
    sessionDir,
    notificationsEnabled,
  } = useSessionData()
  const { setNotificationsEnabled } = useSessionActions()

  const { isSubmitting, isAwaitingResponse, interruptStatus, errorMessage } = useInteraction()

  const claudeStatus = useClaudeStatus()
  const sessionDefaults = useSessionDefaults()
  const { capabilities } = useCapabilities()
  const [copied, copy] = useCopyFlash()
  const [backendCopied, copyBackend] = useCopyFlash()
  const backendId = useCurrentBackendId()

  const showContextUsage = !capabilities || capabilities.supports_context_usage

  // Bar always visible (min 2%) but percentage text shows actual value
  const { percent: contextPercent, barWidth } = computeContextBar(lastContextTokens, contextWindow)

  // On welcome (no active session) workspace from sessionData is null, so fall
  // back to the workspace path from session-defaults so the footer shows the
  // workspace a `+`-clicked session would attach to.
  const effectiveWorkspace = workspace || sessionDefaults?.workspace
  const workspaceName = getWorkspaceName(effectiveWorkspace) || '-'

  const copySessionPath = () => copy(sessionDir)

  return (
    <div className="footer" data-testid="footer">
      {import.meta.env.DEV && (
        <>
          <span className="footer-dev-indicator" title="Development mode">
            DEV
          </span>
          <span className="footer-sep">|</span>
        </>
      )}
      <StatusIndicator
        connectionStatus={connectionStatus}
        connectionError={connectionError}
        isResponding={isResponding}
        respondingSince={respondingSince}
        lastEventTimestamp={lastEventTimestamp}
        isSubmitting={isSubmitting}
        isAwaitingResponse={isAwaitingResponse}
        interruptStatus={interruptStatus}
        errorMessage={errorMessage}
        isReplaying={isResuming || isReplaying}
        isCreating={isCreating}
        isForking={isForking}
        isOpeningBoard={isOpeningBoard}
        isOpeningWorkspace={isOpeningWorkspace}
      />
      <span className="footer-spacer" />
      <span
        className="footer-item"
        title={`Workspace - ${effectiveWorkspace || '-'}`}
        data-testid="footer-workspace">
        {workspaceName}
      </span>
      <span className="footer-sep">|</span>
      <span className="footer-item" title={`Turns - ${numTurns}`} data-testid="footer-turns">
        {numTurns} turns
      </span>
      <span className="footer-sep">|</span>
      <span
        className="footer-item"
        title={`API cost this session - $${totalCostUsd.toFixed(2)}`}
        data-testid="footer-cost">
        ${totalCostUsd.toFixed(2)}
      </span>
      <span className="footer-sep">|</span>
      <span
        className="footer-item"
        title={`Time Claude spent responding - ${formatDurationClock(totalDurationMs)}`}>
        {formatDurationClock(totalDurationMs)}
      </span>
      {showContextUsage && (
        <>
          <span className="footer-sep">|</span>
          <span
            className="footer-item footer-context"
            title={`Context - ${lastContextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}
            data-testid="footer-context">
            <span className="context-bar">
              <span
                className="context-fill"
                style={{ width: `${barWidth}%`, background: getContextBarColor(contextPercent) }}
              />
            </span>
            <span className="context-pct">{Math.round(contextPercent)}%</span>
          </span>
        </>
      )}
      <RuntimeIdentityPill />
      <span className="footer-sep">|</span>
      <ModelPicker
        currentModel={model}
        defaultValue={sessionDefaults?.model}
        disabled={isResponding || isSubmitting || isAwaitingResponse}
      />
      <span className="footer-sep">|</span>
      <EffortLevelPicker
        currentEffortLevel={effortLevel}
        defaultValue={sessionDefaults?.effort_level}
        disabled={isResponding || isSubmitting || isAwaitingResponse}
      />
      <span className="footer-sep">|</span>
      <PermissionModePicker
        currentPermissionMode={permissionMode}
        defaultValue={sessionDefaults?.permission_mode}
        disabled={isResponding || isSubmitting || isAwaitingResponse}
      />
      <span className="footer-sep">|</span>
      <span
        className="footer-item footer-session footer-session-clickable"
        title={formatSessionDirTooltip(sessionDir)}
        data-testid="footer-session"
        onClick={copySessionPath}
        style={{ cursor: sessionDir ? 'pointer' : undefined }}>
        <span style={{ visibility: copied ? 'hidden' : 'visible' }}>{sessionId || '-'}</span>
        {copied && <span className="footer-session-copied-text">Copied!</span>}
      </span>
      <span className="footer-sep">|</span>
      <span
        className="footer-item footer-backend-id"
        title={backendId ? `Container - ${backendId}` : 'No container'}
        data-testid="footer-backend-id"
        onClick={backendId ? () => copyBackend(backendId) : undefined}
        style={{ cursor: backendId ? 'pointer' : undefined }}>
        <span style={{ visibility: backendCopied ? 'hidden' : 'visible' }}>
          {backendId ? backendId.slice(0, 12) : '-'}
        </span>
        {backendCopied && <span className="footer-backend-id-copied-text">Copied!</span>}
      </span>
      <span className="footer-sep">|</span>
      <button
        type="button"
        className={`footer-copy-btn footer-notifications-toggle${notificationsEnabled ? ' enabled' : ''}`}
        onClick={() => setNotificationsEnabled(!notificationsEnabled)}
        title={`Notifications - ${notificationsEnabled ? 'enabled' : 'disabled'}`}
        data-testid="footer-notifications-toggle">
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          role="img"
          aria-label={notificationsEnabled ? 'Notifications enabled' : 'Notifications disabled'}>
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {!notificationsEnabled && <span className="strikethrough" />}
      </button>
      <span className="footer-sep">|</span>
      <button
        type="button"
        className="footer-copy-btn footer-claude-status"
        onClick={() => window.open(STATUS_PAGE_URL, '_blank')}
        title={`Claude Status - ${claudeStatus.description}`}
        data-testid="footer-claude-status">
        <span
          className={`status-dot status-claude-${claudeStatus.error ? 'error' : claudeStatus.indicator}`}
        />
      </button>
    </div>
  )
}
