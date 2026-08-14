/** Element overrides react-markdown renders each markdown tag with. */

import HighlightedText from './components/HighlightedText'
import MarkdownCodeFence from './components/MarkdownCodeFence'
import MermaidDiagram from './components/MermaidDiagram'

// react-markdown uses these functions as the JSX element type per tag.
// A new identity per render forces a subtree remount, not a reconcile - built once at module scope, stays put.
const MARKDOWN_COMPONENTS = {
  a({ href, children, node, ...props }) {
    return (
      <a {...props} href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  },
  p({ children, node, ...props }) {
    return (
      <p {...props}>
        <HighlightedText>{children}</HighlightedText>
      </p>
    )
  },
  li({ children, node, ...props }) {
    return (
      <li {...props}>
        <HighlightedText>{children}</HighlightedText>
      </li>
    )
  },
  td({ children, node, ...props }) {
    return (
      <td {...props}>
        <HighlightedText>{children}</HighlightedText>
      </td>
    )
  },
  th({ children, node, ...props }) {
    return (
      <th {...props}>
        <HighlightedText>{children}</HighlightedText>
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

    if (language === 'mermaid') {
      return <MermaidDiagram chart={code} />
    }

    // Block code - delegated to memoized child so finalized fences bail out of re-render during streaming flushes.
    if (isBlock) {
      return <MarkdownCodeFence code={code} language={language} />
    }

    return (
      <code className={className} {...props}>
        <HighlightedText>{children}</HighlightedText>
      </code>
    )
  },
}

export default MARKDOWN_COMPONENTS
