/** Thin divider line showing model, permission, effort, or container-restart event between turns. */

import { useSessionData } from '../../../context/SessionDataContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { getSettingChangeInfo, isSettingInitEvent } from '../utils/settingLabels'

/**
 * Render a horizontal divider with centered label for a setting-change or container-restart event.
 * @param {Object} props
 * @param {Object} props.event - Divider event (model_changed, permission_mode_changed, effort_level_changed, or container_restarted)
 */
export default function SettingChangeDivider({ event }) {
  // Initialization events (no previous value) are not user-initiated - skip rendering
  const isInit = isSettingInitEvent(event)
  const { availableModels, availablePermissionModes, availableEffortLevels } = useSessionData()
  const { sessions } = useSessionsList()
  const { label, color } = getSettingChangeInfo(event, {
    models: availableModels,
    permissionModes: availablePermissionModes,
    effortLevels: availableEffortLevels,
    sessions,
  })

  if (isInit) {
    return null
  }

  return (
    <div className="setting-change-divider" style={{ color }} data-testid="setting-change-divider">
      <span className="setting-change-line" />
      <span className="setting-change-label">{label}</span>
      <span className="setting-change-line" />
    </div>
  )
}
