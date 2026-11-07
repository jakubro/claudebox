/** Keep a message's inline colour, weight, alignment and width; drop every other style. */

const NAMED_COLOR = /^[a-z]+$/
const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/
const COLOR_FUNCTION = /^(rgba?|hsla?)\(([^()]*)\)$/
const NUMBER = /^\d{1,3}(?:\.\d+)?%?$/
const FONT_WEIGHT = /^(?:normal|bold|[1-9]00)$/
const TEXT_ALIGN = /^(?:left|right|center|justify|start|end)$/
const WIDTH = /^(\d{1,4}(?:\.\d+)?)(px|em|rem|%)$/

const VALUE_RULES = {
  color: colorValue,
  'font-weight': value => (FONT_WEIGHT.test(value) ? value : null),
  'text-align': value => (TEXT_ALIGN.test(value) ? value : null),
  width: widthValue,
}

/** Return `text`'s allowed declarations, rebuilt from their parsed form, or null if none survive. */
export function filterStyle(text) {
  const kept = []
  for (const piece of text.split(';')) {
    const colon = piece.indexOf(':')
    const property = piece.slice(0, colon).trim().toLowerCase()
    const rule = colon > 0 && Object.hasOwn(VALUE_RULES, property) ? VALUE_RULES[property] : null
    const value = rule?.(
      piece
        .slice(colon + 1)
        .trim()
        .toLowerCase(),
    )
    if (value) {
      kept.push(`${property}: ${value}`)
    }
  }
  return kept.length ? kept.join('; ') : null
}

/** Rehype step: replace every element's `style` with its filtered form, or drop it. */
export default function rehypeStyleFilter() {
  return tree => visit(tree)
}

function visit(node) {
  if (node.type === 'element' && node.properties && 'style' in node.properties) {
    const style = node.properties.style
    const filtered = typeof style === 'string' ? filterStyle(style) : null
    if (filtered) {
      node.properties.style = filtered
    } else {
      delete node.properties.style
    }
  }
  for (const child of node.children ?? []) {
    visit(child)
  }
}

function colorValue(value) {
  if (NAMED_COLOR.test(value) || HEX_COLOR.test(value)) {
    return value
  }
  const call = COLOR_FUNCTION.exec(value)
  const args = call && colorArguments(call[2])
  return args ? `${call[1]}(${args})` : null
}

function colorArguments(inner) {
  if (inner.includes(',')) {
    const parts = inner.split(',').map(part => part.trim())
    return parts.length >= 3 && parts.length <= 4 && parts.every(part => NUMBER.test(part))
      ? parts.join(', ')
      : null
  }
  const [channels, alpha, ...rest] = inner.split('/').map(part => part.trim())
  const parts = channels.split(/\s+/)
  const valid =
    rest.length === 0 &&
    parts.length === 3 &&
    parts.every(part => NUMBER.test(part)) &&
    (alpha === undefined || NUMBER.test(alpha))
  if (!valid) {
    return null
  }
  return alpha === undefined ? parts.join(' ') : `${parts.join(' ')} / ${alpha}`
}

function widthValue(value) {
  const match = WIDTH.exec(value)
  if (!match || (match[2] === '%' && Number(match[1]) > 100)) {
    return null
  }
  return `${match[1]}${match[2]}`
}
