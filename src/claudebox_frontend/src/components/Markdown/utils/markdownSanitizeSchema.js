/** Sanitization schema for markdown: structural HTML and the pipeline's own classes, no scripts. */

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

// Classes the pipeline emits ahead of the sanitiser and reads after it.
const MATH_CLASSES = ['math-inline', 'math-display']
const ALERT_CLASSES = ['markdown-alert', /^markdown-alert-(?:note|tip|important|warning|caution)$/]

// className survives only as listed, plus defaultSchema's task-list and footnote classes; `style`
// survives for rehypeStyleFilter, the next step. Scripts, `on*` handlers, javascript:/data: URLs do not.
const markdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), ...EXTRA_TAGS])],
  attributes: {
    ...baseAttributes,
    '*': [...(baseAttributes['*'] ?? []), 'style'],
    a: [...(baseAttributes.a ?? []), 'target', 'rel'],
    blockquote: [...(baseAttributes.blockquote ?? []), ['className', ...ALERT_CLASSES]],
    code: [['className', /^language-./, ...MATH_CLASSES]],
    td: [...(baseAttributes.td ?? []), 'colSpan', 'rowSpan', 'align'],
    th: [...(baseAttributes.th ?? []), 'colSpan', 'rowSpan', 'align'],
    details: [...(baseAttributes.details ?? []), 'open'],
    time: [...(baseAttributes.time ?? []), 'dateTime'],
  },
}

export default markdownSanitizeSchema
