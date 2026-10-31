/** Element overrides react-markdown renders each markdown tag with. */

import GeoMap from './components/GeoMap'
import HighlightedText from './components/HighlightedText'
import MarkdownBlockquote from './components/MarkdownBlockquote'
import MarkdownCodeFence from './components/MarkdownCodeFence'
import MarkdownImage from './components/MarkdownImage'
import MarkdownLink from './components/MarkdownLink'
import MermaidDiagram from './components/MermaidDiagram'
import StlViewer from './components/StlViewer'
import { colorValue } from './utils/colorValue'

// react-markdown uses these functions as the JSX element type per tag.
// A new identity per render forces a subtree remount, not a reconcile - built once at module scope, stays put.
const MARKDOWN_COMPONENTS = {
  a({ node, ...props }) {
    return <MarkdownLink {...props} />
  },
  img({ node, ...props }) {
    return <MarkdownImage {...props} />
  },
  blockquote({ children, node, className, ...props }) {
    return (
      <MarkdownBlockquote {...props} node={node} className={className}>
        {children}
      </MarkdownBlockquote>
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
    if (language === 'geojson' || language === 'topojson') {
      return <GeoMap source={code} format={language} />
    }
    if (language === 'stl') {
      return <StlViewer source={code} />
    }

    // Block code - delegated to memoized child so finalized fences bail out of re-render during streaming flushes.
    if (isBlock) {
      return <MarkdownCodeFence code={code} language={language} />
    }

    const color = colorValue(String(children))
    return (
      <code className={className} {...props}>
        <HighlightedText>{children}</HighlightedText>
        {color && (
          <span className="color-swatch" aria-hidden="true" style={{ backgroundColor: color }} />
        )}
      </code>
    )
  },
}

export default MARKDOWN_COMPONENTS
