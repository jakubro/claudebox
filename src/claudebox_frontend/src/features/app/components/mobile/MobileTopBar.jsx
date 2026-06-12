/** Mobile top bar - hamburger, session name, details toggle. */

import { Menu, MoreHorizontal } from 'lucide-react'
import { useSessionData } from '../../../../context/SessionDataContext'

/**
 * Render mobile top bar with hamburger, session name, and details toggle.
 * @param {object} props
 * @param {Function} props.onHamburger - Open the navigation drawer.
 * @param {Function} props.onToggleDetails - Toggle the details sheet.
 * @param {boolean} props.detailsOpen - Whether details sheet is open.
 */
export default function MobileTopBar({ onHamburger, onToggleDetails, detailsOpen }) {
  const { sessionName } = useSessionData()

  return (
    <div className="mobile-top-bar">
      <button type="button" className="mobile-top-btn" onClick={onHamburger} title="Menu">
        <Menu size={18} />
      </button>
      <span className="mobile-top-session-name" title={sessionName || 'No session'}>
        {sessionName || 'claudebox'}
      </span>
      <div className="mobile-top-actions">
        <button
          type="button"
          className={`mobile-top-btn${detailsOpen ? ' active' : ''}`}
          onClick={onToggleDetails}
          title="Session details">
          <MoreHorizontal size={18} />
        </button>
      </div>
    </div>
  )
}
