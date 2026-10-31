/** Pure derivations for the per-part hover strip - what a part copies and where the strip sits. */

import {
  dropAlertMarker,
  stripQuoteMarkers,
} from '../../../../../components/Markdown/utils/stripQuoteMarkers'

const BOX_INSET = 5
const BOXED = new Set(['BLOCKQUOTE', 'TABLE'])

/** The markdown a top-level part copies: its source span, a quote without its marker, an alert's body. */
export function partCopyText(part, content) {
  const source = content.slice(Number(part.dataset.mdStart), Number(part.dataset.mdEnd))
  if (part.tagName !== 'BLOCKQUOTE') {
    return source
  }
  const text = source.startsWith('>') ? stripQuoteMarkers(source, 1) : part.textContent.trim()
  return part.classList.contains('markdown-alert') ? dropAlertMarker(text) : text
}

/** Top-right of `part`, at the message's right edge; inside the box of a quote, callout or table. */
export function stripPlacement(part, container) {
  if (!BOXED.has(part.tagName)) {
    return { top: part.offsetTop, right: 0 }
  }
  const boxRight = container.clientWidth - part.offsetLeft - part.offsetWidth
  return { top: part.offsetTop + BOX_INSET, right: boxRight + BOX_INSET }
}
