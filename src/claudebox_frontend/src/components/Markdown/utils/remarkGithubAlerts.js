/** Remark plugin recognising GitHub alerts: a top-level quote opening with [!NOTE] and its siblings. */

const MARKER = /^\[!(note|tip|important|warning|caution)\]/i

/** Remove the marker line from each alert quote and tag the quote with `markdown-alert-<kind>`. */
export default function remarkGithubAlerts() {
  return tree => {
    for (const quote of tree.children) {
      if (quote.type === 'blockquote') {
        tagAlert(quote)
      }
    }
  }
}

function tagAlert(quote) {
  const [first] = quote.children
  const text = first?.type === 'paragraph' ? first.children[0] : null
  const match = text?.type === 'text' ? MARKER.exec(text.value) : null
  if (!match) {
    return
  }
  const rest = text.value.slice(match[0].length)
  const markerAlone = rest.startsWith('\n') || (rest === '' && first.children.length === 1)
  if (!markerAlone) {
    return
  }

  text.value = rest.replace(/^\n/, '')
  if (text.value === '' && first.children.length === 1) {
    quote.children.shift()
  }
  const kind = match[1].toLowerCase()
  quote.data = {
    ...quote.data,
    hProperties: { className: ['markdown-alert', `markdown-alert-${kind}`] },
  }
}
