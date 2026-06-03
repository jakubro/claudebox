/** Panel showing available skills (slash commands) organized by category. */

import { useMemo, useState } from 'react'
import PanelListItem from '../../components/PanelListItem'
import { useEvents } from '../../context/EventsContext'
import { useSessionData } from '../../context/SessionDataContext'
import useCapabilities from '../../hooks/useCapabilities'
import { CATEGORY_COLORS, categorizeCommands, flattenCommands, TABS } from '../../utils/categorize'

/** Render panel showing available skills organized by category. */
export default function SkillsPanel() {
  const { capabilities } = useCapabilities()
  const { commands } = useSessionData()
  const { isResuming, isReplaying } = useEvents()
  const [activeTab, setActiveTab] = useState('custom')

  const categorized = useMemo(() => categorizeCommands(commands), [commands])

  // Build display items: [{name, category, usage?, description?}] for current tab
  const displayItems = useMemo(() => {
    if (activeTab === 'all') {
      return flattenCommands(categorized)
    }
    const cmds = categorized[activeTab] || []
    return cmds.map(entry => ({ ...entry, category: activeTab }))
  }, [categorized, activeTab])

  // Count for tab badges
  const counts = useMemo(
    () => ({
      custom: categorized.custom.length,
      mcp: categorized.mcp.length,
      all: categorized.all.length,
    }),
    [categorized],
  )

  if (isResuming || isReplaying) {
    return (
      <div className="skills-panel skills-loading" data-testid="panel-skills">
        Resuming...
      </div>
    )
  }

  if (capabilities && !capabilities.supports_skills) {
    return null
  }

  return (
    <div className="skills-panel" data-testid="panel-skills">
      <div className="skills-tabs">
        {TABS.map(tab => (
          <PanelListItem
            key={tab.id}
            className="skills-tab-btn"
            label={tab.label}
            active={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            count={counts[tab.id]}
          />
        ))}
      </div>

      <div className="skills-list">
        {displayItems.length === 0 ? (
          <div className="skills-list-empty">No skills</div>
        ) : (
          displayItems.map(item => (
            <div key={item.name} className="skills-item" title={item.description}>
              <span className="skills-item-usage">
                <span className="skills-icon" style={{ color: CATEGORY_COLORS[item.category] }}>
                  ●
                </span>
                {item.usage || `/${item.name}`}
              </span>
              {item.description && (
                <span className="skills-item-description">{item.description}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
