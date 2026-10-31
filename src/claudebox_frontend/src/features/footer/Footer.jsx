/** Footer status bar showing session info. */

import { Bell } from 'lucide-react'
import { useContext } from 'react'
import { STATUS_PAGE_URL } from '../../config/urls'
import { useEvents } from '../../context/EventsContext'
import { useInteraction } from '../../context/InteractionContext'
import { useSessionActions, useSessionData } from '../../context/SessionDataContext'
import { WorkspaceContext } from '../../context/WorkspaceContext'
import useBackgroundWaiting from '../../hooks/useBackgroundWaiting'
import useCapabilities from '../../hooks/useCapabilities'
import useCopyFlash from '../../hooks/useCopyFlash'
import useCurrentBackendId from '../../hooks/useCurrentBackendId'
import useSessionDefaults from '../../hooks/useSessionDefaults'
import { getContextBarColor } from '../../utils/color'
import { computeContextBar } from '../../utils/contextBar'
import { formatDurationClock, getWorkspaceName } from '../../utils/formatters'
import { formatSessionDirTooltip } from '../../utils/session'
import BundlePicker from './components/BundlePicker'
import BundlePill from './components/BundlePill'
import EffortLevelPicker from './components/EffortLevelPicker'
import ModelPicker from './components/ModelPicker'
import PermissionModePicker from './components/PermissionModePicker'
import RateLimitItem from './components/RateLimitItem'
import RuntimeIdentityPill from './components/RuntimeIdentityPill'
import StatusIndicator from './components/status-indicator'
import useClaudeStatus from './hooks/useClaudeStatus'
import useRateLimitStatus from './hooks/useRateLimitStatus'

/**
 * Render footer bar: workspace, turns, cost, duration, context, model, session id, notifications, Claude status.
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
  const { isWaiting, awaitingPickup } = useBackgroundWaiting()

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
    pendingModel,
    pendingPermissionMode,
    pendingEffortLevel,
  } = useSessionData()
  const workspaceId = useContext(WorkspaceContext)?.workspaceId ?? null
  // Remounting per session drops a picker's optimistic value, which belongs to the session it was
  // picked in.
  const pickerKey = `${workspaceId}:${sessionId ?? ''}`
  const { setNotificationsEnabled } = useSessionActions()

  const { isSubmitting, isAwaitingResponse, interruptStatus, errorMessage, hintMessage } =
    useInteraction()

  const claudeStatus = useClaudeStatus()
  const rateLimits = useRateLimitStatus()
  const sessionDefaults = useSessionDefaults()
  const { capabilities } = useCapabilities()
  const [copied, copy] = useCopyFlash()
  const [backendCopied, copyBackend] = useCopyFlash()
  const backendId = useCurrentBackendId()

  const showContextUsage = !capabilities || capabilities.supports_context_usage

  // Bar always visible (min 2%) but percentage text shows actual value
  const { percent: contextPercent, barWidth } = computeContextBar(lastContextTokens, contextWindow)

  // On welcome, workspace is null; falls back to session-defaults so footer shows what `+` would attach to.
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
        isResponding={isResponding || awaitingPickup}
        respondingSince={respondingSince}
        lastEventTimestamp={lastEventTimestamp}
        isSubmitting={isSubmitting}
        isAwaitingResponse={isAwaitingResponse}
        isWaiting={isWaiting}
        interruptStatus={interruptStatus}
        errorMessage={errorMessage}
        hintMessage={hintMessage}
        isReplaying={isResuming || isReplaying}
        isCreating={isCreating}
        isForking={isForking}
        isOpeningBoard={isOpeningBoard}
        isOpeningWorkspace={isOpeningWorkspace}
      />
      <span className="footer-spacer" />
      {rateLimits.map(entry => (
        <RateLimitItem key={entry.window} entry={entry} />
      ))}
      <span
        className="footer-item"
        title={`Workspace — ${effectiveWorkspace || '-'}`}
        data-testid="footer-workspace">
        {workspaceName}
      </span>
      <span className="footer-sep">|</span>
      <span className="footer-item" title={`Turns — ${numTurns}`} data-testid="footer-turns">
        {numTurns} turns
      </span>
      <span className="footer-sep">|</span>
      <span
        className="footer-item"
        title={`API cost this session — $${totalCostUsd.toFixed(2)}`}
        data-testid="footer-cost">
        ${totalCostUsd.toFixed(2)}
      </span>
      <span className="footer-sep">|</span>
      <span
        className="footer-item"
        title={`Time Claude spent responding — ${formatDurationClock(totalDurationMs)}`}>
        {formatDurationClock(totalDurationMs)}
      </span>
      {showContextUsage && (
        <>
          <span className="footer-sep">|</span>
          <span
            className="footer-item footer-context"
            title={`Context — ${lastContextTokens.toLocaleString()} / ${contextWindow.toLocaleString()} tokens`}
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
      {sessionId ? <BundlePill /> : <BundlePicker />}
      <span className="footer-sep">|</span>
      <ModelPicker
        key={`model:${pickerKey}`}
        currentModel={pendingModel || model}
        defaultValue={sessionDefaults?.model}
        disabled={isResponding || isSubmitting || isAwaitingResponse}
      />
      <span className="footer-sep">|</span>
      <EffortLevelPicker
        key={`effort:${pickerKey}`}
        currentEffortLevel={pendingEffortLevel || effortLevel}
        defaultValue={sessionDefaults?.effort_level}
        disabled={isResponding || isSubmitting || isAwaitingResponse}
      />
      <span className="footer-sep">|</span>
      <PermissionModePicker
        key={`permission:${pickerKey}`}
        currentPermissionMode={pendingPermissionMode || permissionMode}
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
        <span style={{ visibility: copied ? 'hidden' : 'visible' }}>
          {sessionId ? sessionId.split('-')[0] : '-'}
        </span>
        {copied && <span className="footer-session-copied-text">Copied!</span>}
      </span>
      <span className="footer-sep">|</span>
      <span
        className="footer-item footer-backend-id"
        title={backendId ? `Container — ${backendId}` : 'No container'}
        data-testid="footer-backend-id"
        onClick={backendId ? () => copyBackend(backendId) : undefined}
        style={{ cursor: backendId ? 'pointer' : undefined }}>
        <span style={{ visibility: backendCopied ? 'hidden' : 'visible' }}>
          {backendId ? backendId.slice(0, 8) : '-'}
        </span>
        {backendCopied && <span className="footer-backend-id-copied-text">Copied!</span>}
      </span>
      <span className="footer-sep">|</span>
      <button
        type="button"
        className={`footer-copy-btn footer-notifications-toggle${notificationsEnabled ? ' enabled' : ''}`}
        onClick={() => setNotificationsEnabled(!notificationsEnabled)}
        title={`Notifications — ${notificationsEnabled ? 'enabled' : 'disabled'}`}
        data-testid="footer-notifications-toggle">
        <Bell
          size={10}
          role="img"
          aria-label={notificationsEnabled ? 'Notifications enabled' : 'Notifications disabled'}
        />
        {!notificationsEnabled && <span className="strikethrough" />}
      </button>
      <span className="footer-sep">|</span>
      <button
        type="button"
        className="footer-copy-btn footer-claude-status"
        onClick={() => window.open(STATUS_PAGE_URL, '_blank')}
        title={`Claude Status — ${claudeStatus.description}`}
        data-testid="footer-claude-status">
        <span
          className={`status-dot status-claude-${claudeStatus.error ? 'error' : claudeStatus.indicator}`}
        />
      </button>
    </div>
  )
}
