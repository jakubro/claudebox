/** Panel of scheduled prompts, soonest first: the open session's, or every running session's. */

import { useCallback, useMemo } from 'react'
import SessionScopeTabs from '../../components/SessionScopeTabs'
import { LIVE_TICK_INTERVAL_MS } from '../../config/timing'
import { useAppActions } from '../../context/AppActionsContext'
import { useContainerMap } from '../../context/ContainerMapContext'
import { useEvents } from '../../context/EventsContext'
import { useSessionData } from '../../context/SessionDataContext'
import { useSessionsList } from '../../context/SessionsContext'
import useNow from '../../hooks/useNow'
import useOpenInNewTab from '../../hooks/useOpenInNewTab'
import useSessionScopeTab from '../../hooks/useSessionScopeTab'
import useSwitchToSession from '../../hooks/useSwitchToSession'
import { toolJumpOptions } from '../../utils/bookmarkIds'
import { extractCrons } from '../../utils/eventProcessing'
import { displayName, isAutoNamed } from '../../utils/sessionName'
import CronEntry from './components/cron-entry'
import useSessionSchedules from './hooks/useSessionSchedules'
import { mergeSessionCrons } from './utils/sessionCrons'

export default function CronsPanel() {
  const { events, isResponding, respondingSince, isResuming, isReplaying } = useEvents()
  const { sessionId } = useSessionData()
  const { focusChatTab, jumpToTaskRef } = useAppActions()
  const { sessions } = useSessionsList()
  const { deriveSessionStatus } = useContainerMap()
  const [tab, setTab] = useSessionScopeTab(sessionId)
  const { openingKey, openInNewTab } = useOpenInNewTab()
  const switchToSession = useSwitchToSession()
  const { sources, loaded, failed } = useSessionSchedules()
  const now = useNow(LIVE_TICK_INTERVAL_MS)

  const loading = isResuming || isReplaying
  const turnStartedAt = isResponding ? respondingSince : null
  const crons = useMemo(
    () => extractCrons(events, now, turnStartedAt),
    [events, now, turnStartedAt],
  )

  const allCrons = useMemo(() => {
    const isRunning = sid => deriveSessionStatus(sid, sessions) === 'running'
    const sessionOf = sid => {
      const session = sessions.find(s => s.session_id === sid)
      return {
        sessionName: displayName(session) || sid.slice(0, 8),
        sessionNameIsAuto: isAutoNamed(session),
      }
    }
    const own = sessionId ? { sessionId, crons, loading } : null
    return mergeSessionCrons({ own, sources, now, isRunning, sessionOf })
  }, [sessionId, crons, loading, sources, now, sessions, deriveSessionStatus])

  // The scheduling call is a tool block like any other, so the task jump lands on it.
  const handleCronClick = useCallback(
    cron => {
      focusChatTab()
      requestAnimationFrame(() =>
        jumpToTaskRef.current?.({ id: cron.toolUseId, turnId: cron.turnId }),
      )
    },
    [focusChatTab, jumpToTaskRef],
  )

  const rowProps = (cron, sid, key) => {
    const jump = toolJumpOptions(cron.turnId, cron.toolUseId)
    return {
      key,
      cron,
      now,
      opening: openingKey === key,
      onClick: e => {
        if (e.altKey) {
          openInNewTab(sid, key, jump)
        } else if (sid === sessionId) {
          handleCronClick(cron)
        } else {
          switchToSession(sid, jump)
        }
      },
      onAuxClick: e => {
        if (e.button === 1) {
          e.preventDefault()
          openInNewTab(sid, key, jump)
        }
      },
    }
  }

  const sessionRows = loading ? [] : crons
  const empty = text => <p className="crons-empty">{text}</p>

  let body
  if (tab === 'session') {
    body = loading
      ? empty('Resuming...')
      : sessionRows.length === 0
        ? empty('No scheduled prompts')
        : sessionRows.map(cron => (
            <CronEntry {...rowProps(cron, sessionId, cron.toolUseId)} key={cron.toolUseId} />
          ))
  } else {
    const rows = allCrons.map(cron => {
      const key = `${cron.sessionId}/${cron.toolUseId}`
      return (
        <CronEntry
          {...rowProps(cron, cron.sessionId, key)}
          key={key}
          session={{ name: cron.sessionName, isAutoNamed: cron.sessionNameIsAuto }}
        />
      )
    })
    body = (
      <>
        {rows}
        {failed && empty("Could not load other sessions' schedules")}
        {rows.length === 0 && !failed && empty(loaded ? 'No scheduled prompts' : 'Loading...')}
      </>
    )
  }

  return (
    <div className="crons-panel" data-testid="panel-crons">
      <SessionScopeTabs
        tab={tab}
        onTabChange={setTab}
        sessionCount={sessionRows.length}
        allCount={allCrons.length}
      />
      <div className="crons-list">{body}</div>
    </div>
  )
}
