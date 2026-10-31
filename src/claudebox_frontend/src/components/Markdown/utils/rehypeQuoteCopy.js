/** Rehype step storing each quote's copy text on its node's `data`, from the markdown it was written in. */

import { dropAlertMarker, stripQuoteMarkers } from './stripQuoteMarkers'

/** Set `data.copyText` on every blockquote: its source minus one marker level, or its text content. */
export default function rehypeQuoteCopy() {
  return (tree, file) => {
    const source = String(file.value ?? '')
    visit(tree, 0)

    function visit(node, depth) {
      const isQuote = node.type === 'element' && node.tagName === 'blockquote'
      const inner = isQuote ? depth + 1 : depth
      if (isQuote) {
        const start = node.position?.start?.offset
        const end = node.position?.end?.offset
        const span = start === undefined || end === undefined ? '' : source.slice(start, end)
        const copyText = span.startsWith('>') ? stripQuoteMarkers(span, inner) : textOf(node).trim()
        node.data = { ...node.data, copyText: isAlert(node) ? dropAlertMarker(copyText) : copyText }
      }
      for (const child of node.children ?? []) {
        visit(child, inner)
      }
    }
  }
}

function isAlert(node) {
  return [node.properties?.className ?? []].flat().includes('markdown-alert')
}

function textOf(node) {
  if (node.type === 'text') {
    return node.value
  }
  return (node.children ?? []).map(textOf).join('')
}
