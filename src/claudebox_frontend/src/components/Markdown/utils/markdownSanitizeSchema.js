/** Sanitization schema for rendered markdown - permissive structural/presentational HTML, hard block on scripts, event handlers, and unsafe URL protocols. */

import { defaultSchema } from 'rehype-sanitize'

// Extra tags on top of GitHub's default set; kept denied: script, iframe, object, embed, svg, form, input.
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

// Permissive: className + style allowed on every element, verbatim.
// className must survive for `language-*` fences (highlighting, mermaid) and KaTeX's math placeholders.
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
