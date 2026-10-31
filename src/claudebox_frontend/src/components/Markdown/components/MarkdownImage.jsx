/** A markdown image: relative sources load from a web base, else through the workspace image route. */

import { useContext, useState } from 'react'
import { workspaceUrl } from '../../../api/apiClient'
import { imageEndpointQuery, resolveWebUrl } from '../../../utils/relativeUrl'
import MarkdownPathContext from '../MarkdownPathContext'

/**
 * A source leading outside its directory renders with no `src`, so the browser shows the alt text.
 * @param {string} [props.src] - The image source as the message wrote it
 */
export default function MarkdownImage({ src, alt, className, ...props }) {
  const scope = useContext(MarkdownPathContext)
  // The page keeps a fetched image per URL; a key per mounted image lets a new message reread the file.
  const [mountKey] = useState(() => Date.now().toString(36))
  const query = scope.baseUrl ? undefined : imageEndpointQuery(src, scope)
  const resolvedSrc = scope.baseUrl
    ? (src && resolveWebUrl(src, scope.baseUrl)) || src
    : query === undefined
      ? src
      : query === null
        ? undefined
        : workspaceUrl(`/files/image?${query}&v=${mountKey}`)

  return (
    <img
      {...props}
      alt={alt}
      className={className ? `${className} md-image` : 'md-image'}
      src={resolvedSrc}
    />
  )
}
