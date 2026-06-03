/** Shared markdown renderer with GFM, math, syntax-highlighted code, mermaid, and path highlighting. */

import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useSessionDir } from '../context/SessionDataContext'
import usePathResolution from '../hooks/usePathResolution'
import { extractPathCandidates, uniqueCandidates } from '../utils/pathCandidates'
import MarkdownCodeFence from './MarkdownCodeFence'
import MermaidDiagram from './MermaidDiagram'
import PathHighlighter from './PathHighlighter'

/**
 * Render markdown content with GFM, math, syntax-highlighted code blocks, mermaid, and path highlighting.
 *
 * Path highlighting and session-dir resolution gracefully degrade when used outside
 * SessionDataContext — `useSessionDir` returns null and `usePathResolution` returns an empty map.
 *
 * @param {Object} props
 * @param {string} props.children - Markdown text to render.
 * @param {string} [props.className] - Optional CSS class for an outer wrapper div.
 */
function Markdown({ children, className }) {
  const sessionDir = useSessionDir()
  const candidates = useMemo(() => uniqueCandidates(extractPathCandidates(children)), [children])
  const resolvedPaths = usePathResolution(candidates)

  const content = (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        p({ children }) {
          return (
            <p>
              <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
                {children}
              </PathHighlighter>
            </p>
          )
        },
        li({ children }) {
          return (
            <li>
              <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
                {children}
              </PathHighlighter>
            </li>
          )
        },
        td({ children }) {
          return (
            <td>
              <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
                {children}
              </PathHighlighter>
            </td>
          )
        },
        th({ children }) {
          return (
            <th>
              <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
                {children}
              </PathHighlighter>
            </th>
          )
        },
        code({ className, children, node, ...props }) {
          const match = /language-(\w+)/.exec(className || '')
          const language = match ? match[1] : null
          const isBlock =
            node?.position?.start?.line !== node?.position?.end?.line ||
            String(children).includes('\n') ||
            language
          const code = String(children).replace(/\n$/, '')

          // Mermaid diagrams — render as visual SVG
          if (language === 'mermaid') {
            return <MermaidDiagram chart={code} />
          }

          // Block code — delegated to memoized child so finalized fences
          // bail out of re-render during streaming flushes.
          if (isBlock) {
            return <MarkdownCodeFence code={code} language={language} />
          }

          // Inline code
          return (
            <code className={className} {...props}>
              <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
                {children}
              </PathHighlighter>
            </code>
          )
        },
      }}>
      {children}
    </ReactMarkdown>
  )

  return className ? <div className={className}>{content}</div> : content
}

export default memo(Markdown)
