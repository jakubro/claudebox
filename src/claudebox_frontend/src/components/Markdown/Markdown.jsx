/** Shared markdown renderer with GFM, math, syntax-highlighted code, mermaid, and path highlighting. */

import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useSessionDir } from '../../context/SessionDataContext'
import useEditorTemplate from '../../hooks/useEditorTemplate'
import usePathResolution from '../../hooks/usePathResolution'
import { extractPathCandidates, uniqueCandidates } from '../../utils/pathCandidates'
import MarkdownPathContext from './MarkdownPathContext'
import MARKDOWN_COMPONENTS from './markdownComponents'
import markdownSanitizeSchema from './utils/markdownSanitizeSchema'

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeRaw, [rehypeSanitize, markdownSanitizeSchema], rehypeKatex]

/**
 * Degrades gracefully outside SessionDataContext: useSessionDir returns null, usePathResolution returns {}.
 * @param {object} props
 * @param {string} props.children - Markdown text to render.
 * @param {string} [props.className] - Optional CSS class for an outer wrapper div.
 */
function Markdown({ children, className }) {
  const sessionDir = useSessionDir()
  const editorTemplate = useEditorTemplate()
  const candidates = useMemo(() => uniqueCandidates(extractPathCandidates(children)), [children])
  const resolvedPaths = usePathResolution(candidates)
  const pathContextValue = useMemo(
    () => ({ sessionDir, resolvedPaths, editorTemplate }),
    [sessionDir, resolvedPaths, editorTemplate],
  )

  const content = (
    <MarkdownPathContext.Provider value={pathContextValue}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </MarkdownPathContext.Provider>
  )

  return className ? <div className={className}>{content}</div> : content
}

export default memo(Markdown)
