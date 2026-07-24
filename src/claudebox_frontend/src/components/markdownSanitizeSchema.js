/** Sanitization schema for rendered markdown - permissive structural/presentational HTML, hard block on scripts, event handlers, and unsafe URL protocols. */

import { defaultSchema } from 'rehype-sanitize'

// Structural/presentational tags layered on top of the GitHub default set.
// Omitted on purpose (stay denied): script, iframe, object, embed, svg, form, input.
const EXTRA_TAGS = [
  'details',
  'summary',
  'kbd',
  'mark',
  'sub',
  'sup',
  'abbr',
  'dl',
  'dt',
  'dd',
  'figure',
  'figcaption',
  'section',
  'article',
  'aside',
  'time',
  'wbr',
  'bdi',
  'bdo',
  'caption',
  'colgroup',
  'col',
]

const baseAttributes = defaultSchema.attributes ?? {}

// Permissive policy: className + style allowed on every element (any value, verbatim).
// className must survive so `language-*` code fences (highlighting, mermaid routing) and
// `math-inline`/`math-display` placeholders (KaTeX) keep working through sanitization.
// Scripts, `on*` handlers, and javascript:/data: URLs remain stripped by defaultSchema.
const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), ...EXTRA_TAGS])],
  attributes: {
    ...baseAttributes,
    '*': [...(baseAttributes['*'] ?? []), 'className', 'style'],
    a: [...(baseAttributes.a ?? []), 'target', 'rel'],
    td: [...(baseAttributes.td ?? []), 'colSpan', 'rowSpan', 'align'],
    th: [...(baseAttributes.th ?? []), 'colSpan', 'rowSpan', 'align'],
    details: [...(baseAttributes.details ?? []), 'open'],
    time: [...(baseAttributes.time ?? []), 'dateTime'],
  },
}

export default markdownSanitizeSchema
