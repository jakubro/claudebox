/** Path-highlighting wrapper that reads its inputs from the ambient markdown path context. */

import { useContext } from 'react'
import PathHighlighter from '../../PathHighlighter'
import MarkdownPathContext from '../MarkdownPathContext'

/**
 * @param {object} props
 * @param {React.ReactNode} props.children - Content to scan for paths.
 */
function HighlightedText({ children }) {
  const { sessionDir, resolvedPaths, editorTemplate } = useContext(MarkdownPathContext)
  return (
    <PathHighlighter
      sessionDir={sessionDir}
      resolvedPaths={resolvedPaths}
      editorTemplate={editorTemplate}>
      {children}
    </PathHighlighter>
  )
}

export default HighlightedText
