/** Display labels and colors for setting-change and container-restart dividers. */

import { EventSubtype, PermissionMode } from '../../../config/schema'

// Unmuted versions of footer permission mode colors (#a08050, #7a9ea8, #6a9a6a, #80503e, #807a98)
const MODE_COLORS = {
  [PermissionMode.BYPASS]: '#c8a060',
  [PermissionMode.PLAN]: '#7ac0d4',
  [PermissionMode.ACCEPT_EDITS]: '#6ac86a',
  [PermissionMode.DONT_ASK]: '#a06850',
  [PermissionMode.AUTO]: '#9890b0',
  default: '#999',
}

const MODEL_COLOR = '#8888bb'
const EFFORT_COLOR = '#9a7ec8'
const RESTART_COLOR = '#c89060'

/** Label + color for a setting-change / container-restart divider event. */
export function getSettingChangeInfo(
  event,
  { models = [], permissionModes = [], effortLevels = [], sessions = [] } = {},
) {
  if (event.subtype === EventSubtype.MODEL_CHANGED) {
    const id = event.model
    const model = models.find(m => m.id === id)
    return {
      label: model?.name || id || 'Unknown',
      color: MODEL_COLOR,
    }
  }
  if (event.subtype === EventSubtype.PERMISSION_MODE_CHANGED) {
    const id = event.permission_mode
    const permissionMode = permissionModes.find(m => m.id === id)
    return {
      label: permissionMode?.name || id || 'Unknown',
      color: MODE_COLORS[id] || '#999',
    }
  }
  if (event.subtype === EventSubtype.EFFORT_LEVEL_CHANGED) {
    const id = event.content
    const level = effortLevels.find(l => l.id === id)
    const displayName = level?.name || id || 'Unknown'
    return {
      label: `Effort: ${displayName}`,
      color: EFFORT_COLOR,
    }
  }
  if (event.subtype === EventSubtype.CONTAINER_RESTARTED) {
    const forkParentId = event.message_data?.fork_parent_session_id
    if (forkParentId) {
      const parent = sessions.find(s => s.session_id === forkParentId)
      return {
        label: `Forked from ${parent?.name || forkParentId}`,
        color: RESTART_COLOR,
      }
    }
    return { label: 'Restarted', color: RESTART_COLOR }
  }
  return { label: 'Unknown', color: '#999' }
}

/**
 * Whether a divider event represents the session's initial value, i.e. set
 * during bootstrap rather than by user action. Setting-change events with no
 * `previous_*` field are init; lifecycle events (e.g. container_restarted)
 * have no init concept and always render.
 */
export function isSettingInitEvent(event) {
  if (event.subtype === EventSubtype.MODEL_CHANGED) {
    return event.previous_model == null
  }
  if (event.subtype === EventSubtype.EFFORT_LEVEL_CHANGED) {
    return event.previous_effort_level == null
  }
  if (event.subtype === EventSubtype.PERMISSION_MODE_CHANGED) {
    return event.previous_permission_mode == null
  }
  return false
}
