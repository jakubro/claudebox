/** Shared markdown renderer with GFM, math, syntax-highlighted code, mermaid, and path highlighting. */

import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeSlug from 'rehype-slug'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useSessionDir, useSessionId, useSessionWorkspace } from '../../context/SessionDataContext'
import useEditorTemplate from '../../hooks/useEditorTemplate'
import usePathResolution from '../../hooks/usePathResolution'
import { extractPathCandidates, uniqueCandidates } from '../../utils/pathCandidates'
import { webPageUrl } from '../../utils/relativeUrl'
import MarkdownPathContext from './MarkdownPathContext'
import MARKDOWN_COMPONENTS from './markdownComponents'
import markdownSanitizeSchema from './utils/markdownSanitizeSchema'
import rehypeMarkBlocks, { rehypeRecordBlockSpans } from './utils/rehypeMarkBlocks'
import rehypeQuoteCopy from './utils/rehypeQuoteCopy'
import remarkGithubAlerts from './utils/remarkGithubAlerts'
import remarkMathBacktick from './utils/remarkMathBacktick'

// micromark tries the last-registered construct for a character first, so the backtick form wins `$`.
const REMARK_PLUGINS = [remarkGfm, remarkGithubAlerts, remarkMath, remarkMathBacktick]
const REHYPE_PLUGINS = [
  rehypeRaw,
  rehypeSlug,
  [rehypeSanitize, markdownSanitizeSchema],
  rehypeQuoteCopy,
  rehypeRecordBlockSpans,
  rehypeKatex,
  rehypeMarkBlocks,
]
// Footnote ids take their one `user-content-` prefix from sanitize, as heading and anchor ids do.
const REMARK_REHYPE_OPTIONS = { clobberPrefix: '' }

/**
 * Degrades gracefully outside SessionDataContext: useSessionDir returns null, usePathResolution returns {}.
 * @param {object} props
 * @param {string} props.children - Markdown text to render.
 * @param {string} [props.className] - Optional CSS class for an outer wrapper div.
 * @param {boolean} [props.hostsBlockActions] - Host copies top-level parts; their quotes drop their button.
 * @param {number[]|null} [props.markedBlocks] - Ordinals of top-level blocks drawn as bookmarked.
 * @param {string|null} [props.baseDir] - Directory relative links and images resolve against.
 * @param {string|null} [props.baseUrl] - Web page relative links and images resolve against.
 */
function Markdown({
  children,
  className,
  hostsBlockActions = false,
  markedBlocks = null,
  baseDir = null,
  baseUrl: givenBaseUrl = null,
}) {
  const sessionDir = useSessionDir()
  const sessionId = useSessionId()
  const workspaceDir = useSessionWorkspace()
  const baseUrl = webPageUrl(givenBaseUrl)
  const editorTemplate = useEditorTemplate()
  const candidates = useMemo(() => uniqueCandidates(extractPathCandidates(children)), [children])
  const resolvedPaths = usePathResolution(candidates)
  const pathContextValue = useMemo(
    () => ({
      sessionDir,
      resolvedPaths,
      editorTemplate,
      hostsBlockActions,
      baseDir,
      baseUrl,
      workspaceDir,
      sessionId,
    }),
    [
      sessionDir,
      resolvedPaths,
      editorTemplate,
      hostsBlockActions,
      baseDir,
      baseUrl,
      workspaceDir,
      sessionId,
    ],
  )

  const rehypePlugins = useMemo(
    () =>
      markedBlocks?.length
        ? [...REHYPE_PLUGINS.slice(0, -1), [rehypeMarkBlocks, { marked: markedBlocks }]]
        : REHYPE_PLUGINS,
    [markedBlocks],
  )

  const content = (
    <MarkdownPathContext.Provider value={pathContextValue}>
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        remarkRehypeOptions={REMARK_REHYPE_OPTIONS}
        rehypePlugins={rehypePlugins}
        components={MARKDOWN_COMPONENTS}>
        {children}
      </ReactMarkdown>
    </MarkdownPathContext.Provider>
  )

  return className ? <div className={className}>{content}</div> : content
}

export default memo(Markdown)
