/** Collapsed "Replied inline" placeholder that expands to reveal each quote/reply pair. */

import { ChevronDown, ChevronRight, MessageSquareQuote } from 'lucide-react'
import { useState } from 'react'

/**
 * Display a compact inline-replies placeholder that expands in place to show quote/reply pairs.
 * @param {object} props
 * @param {Array} props.replies - Inline reply pairs, each { quote, from, response }.
 */
export default function InlineReplies({ replies }) {
  const [expanded, setExpanded] = useState(false)
  const count = replies.length
  const label = `Replied inline - ${count} comment${count === 1 ? '' : 's'}`

  return (
    <div className="inline-replies-placeholder">
      <button
        type="button"
        className="inline-replies-summary"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        data-testid="inline-replies-placeholder">
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <MessageSquareQuote size={14} />
        <span className="inline-replies-label">{label}</span>
      </button>
      {expanded && (
        <div className="inline-replies-pairs">
          {replies.map((reply, i) => (
            <div key={i} className="inline-reply-pair">
              <div className="inline-reply-quote">
                <span className="inline-reply-from">{reply.from}</span>
                <span className="inline-reply-quote-text">{reply.quote}</span>
              </div>
              <div className="inline-reply-response">{reply.response}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
