/** Read-only ticket detail overlay showing rendered markdown content. */

import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { getTicketContent } from '../../../api/boards'
import Markdown from '../../../components/Markdown'

/**
 * Render a modal overlay with ticket metadata and rendered markdown.
 * @param {object} props
 * @param {object} props.ticket - Ticket data (path, title, column, swimlane, session, status).
 * @param {Array} props.states - Board states with id/label for display lookup.
 * @param {Array} props.swimlanes - Board swimlanes with id/name for display lookup.
 * @param {Function} props.onClose - Close the overlay.
 */
export default function TicketDetail({ ticket, states = [], swimlanes = [], onClose }) {
  const [content, setContent] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function fetchContent() {
      try {
        const text = await getTicketContent(ticket.boardId, ticket.path)
        if (!cancelled) {
          setContent(text)
        }
      } catch {
        if (!cancelled) {
          setContent('Failed to load ticket content.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchContent()
    return () => {
      cancelled = true
    }
  }, [ticket.path, ticket.boardId])

  const handleKeyDown = useCallback(
    e => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div className="ticket-detail-backdrop" onClick={onClose}>
      <div className="ticket-detail-panel" onClick={e => e.stopPropagation()}>
        <div className="ticket-detail-header">
          <h3 className="ticket-detail-title">
            {ticket.title || ticket.path.split('/').pop().replace(/\.md$/, '')}
          </h3>
          <button type="button" className="ticket-detail-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="ticket-detail-meta">
          <div className="ticket-meta-row">
            <span className="ticket-meta-label">Status</span>
            <span className="ticket-meta-value">
              {states.find(s => s.id === ticket.column)?.label || ticket.column || 'unknown'}
            </span>
          </div>
          {ticket.swimlane && (
            <div className="ticket-meta-row">
              <span className="ticket-meta-label">Swimlane</span>
              <span className="ticket-meta-value">
                {swimlanes.find(s => s.id === ticket.swimlane)?.name || ticket.swimlane}
              </span>
            </div>
          )}
          <div className="ticket-meta-row">
            <span className="ticket-meta-label">Session</span>
            <span className="ticket-meta-value">
              {ticket.session
                ? `${ticket.session.slice(0, 8)} (${ticket.status || 'unknown'})`
                : '-'}
            </span>
          </div>
        </div>

        <div className="ticket-detail-content">
          {loading ? (
            <div className="ticket-detail-loading">Loading...</div>
          ) : (
            <Markdown className="turn-text">{content}</Markdown>
          )}
        </div>
      </div>
    </div>
  )
}
