/** A markdown quote with its copy button, and an alert's header when it is one. */

import { Info, Lightbulb, MessageSquareWarning, OctagonAlert, TriangleAlert } from 'lucide-react'
import { useContext } from 'react'
import CopyButton from '../../CopyButton.jsx'
import MarkdownPathContext from '../MarkdownPathContext'

const ALERTS = {
  note: { Icon: Info, title: 'Note' },
  tip: { Icon: Lightbulb, title: 'Tip' },
  important: { Icon: MessageSquareWarning, title: 'Important' },
  warning: { Icon: TriangleAlert, title: 'Warning' },
  caution: { Icon: OctagonAlert, title: 'Caution' },
}

/**
 * @param {object} props.node - The quote's hast node, carrying its copy text
 * @param {string} [props.className] - Classes from markdown, alert classes included
 */
export default function MarkdownBlockquote({ node, className, children, ...props }) {
  const { hostsBlockActions } = useContext(MarkdownPathContext)
  const alert = ALERTS[/\bmarkdown-alert-(\w+)/.exec(className ?? '')?.[1]]
  // A host that supplies per-block actions copies a top-level quote itself.
  const ownButton = !(hostsBlockActions && node?.properties?.dataMdBlock !== undefined)

  return (
    <blockquote {...props} className={className ? `${className} md-blockquote` : 'md-blockquote'}>
      {ownButton && (
        <CopyButton
          text={node?.data?.copyText ?? ''}
          className="blockquote-copy-btn"
          title="Copy quote"
          size={12}
        />
      )}
      {alert && (
        <p className="markdown-alert-title">
          <alert.Icon size={14} aria-hidden="true" />
          {alert.title}
        </p>
      )}
      {children}
    </blockquote>
  )
}
