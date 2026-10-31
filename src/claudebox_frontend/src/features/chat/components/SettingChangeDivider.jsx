/** Thin divider line between turns naming a run of model, permission, effort or restart changes. */

import { useSessionData } from '../../../context/SessionDataContext'
import { useSessionsList } from '../../../context/SessionsContext'
import { getSettingChangeInfo, MERGED_LINE_COLOR } from '../utils/settingLabels'

/**
 * @param {Object} props
 * @param {Array<Object>} props.events - One divider row: a single event, or a merged run with one event per kind
 */
export default function SettingChangeDivider({ events }) {
  const { availableModels, availablePermissionModes, availableEffortLevels } = useSessionData()
  const { sessions } = useSessionsList()
  const entries = events.map(event =>
    getSettingChangeInfo(event, {
      models: availableModels,
      permissionModes: availablePermissionModes,
      effortLevels: availableEffortLevels,
      sessions,
    }),
  )

  if (entries.length === 1) {
    const [{ label, color }] = entries
    return (
      <div
        className="setting-change-divider"
        style={{ color }}
        data-testid="setting-change-divider">
        <span className="setting-change-line" />
        <span className="setting-change-label">{label}</span>
        <span className="setting-change-line" />
      </div>
    )
  }

  return (
    <div
      className="setting-change-divider setting-change-divider-merged"
      style={{ color: MERGED_LINE_COLOR }}
      data-testid="setting-change-divider">
      <span className="setting-change-line" />
      <span className="setting-change-label">
        {entries.map(({ label, color }, i) => (
          <span key={events[i].subtype}>
            {i > 0 && ' · '}
            <span className="setting-change-entry" style={{ color }}>
              {label}
            </span>
          </span>
        ))}
      </span>
      <span className="setting-change-line" />
    </div>
  )
}
