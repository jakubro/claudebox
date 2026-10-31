/** The "This session" / "All sessions" tab bar, each tab with its count. */

import PanelListItem from './PanelListItem'

/**
 * @param {Object} props
 * @param {'session'|'all'} props.tab - The tab shown.
 * @param {function('session'|'all'): void} props.onTabChange - Called with the tab clicked.
 * @param {number} props.sessionCount - Items of the open session.
 * @param {number} props.allCount - Items of every session.
 */
export default function SessionScopeTabs({ tab, onTabChange, sessionCount, allCount }) {
  return (
    <div className="session-scope-tabs">
      <PanelListItem
        label="This session"
        active={tab === 'session'}
        onClick={() => onTabChange('session')}
        count={sessionCount}
      />
      <PanelListItem
        label="All sessions"
        active={tab === 'all'}
        onClick={() => onTabChange('all')}
        count={allCount}
      />
    </div>
  )
}
