/** A markdown link: fragments jump, relative ones resolve against the base named, else show as text. */

import { useContext } from 'react'
import { handlePathClick, pathTitle } from '../../../utils/pathClick'
import { isRelativeUrl, resolveRelative, resolveWebUrl } from '../../../utils/relativeUrl'
import MarkdownPathContext from '../MarkdownPathContext'
import { jumpToFragment } from '../utils/fragmentJump'

/** @param {string} [props.href] - The link target as the message wrote it */
export default function MarkdownLink({ href, children, ...props }) {
  const { baseDir, baseUrl, editorTemplate } = useContext(MarkdownPathContext)

  if (href?.startsWith('#')) {
    return (
      <a
        {...props}
        href={href}
        onClick={event => {
          event.preventDefault()
          jumpToFragment(event.currentTarget, href)
        }}>
        {children}
      </a>
    )
  }

  const webHref = baseUrl && href ? resolveWebUrl(href, baseUrl) : null
  if (webHref) {
    return (
      <a {...props} href={webHref} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }

  if (baseDir && isRelativeUrl(href)) {
    const resolved = resolveRelative(href, baseDir)
    if (!resolved) {
      return children
    }
    return (
      <a
        {...props}
        href={href}
        title={pathTitle(resolved.absolute, editorTemplate)}
        onClick={event => handlePathClick(event, resolved.absolute, editorTemplate)}>
        {children}
      </a>
    )
  }

  if (isRelativeUrl(href)) {
    return children
  }

  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}
