/** Markdown list-marker parsing for Shift+Enter list continuation in the chat textarea. */

const TASK_RE = /^([ \t]*)([-*+]) \[([ xX])\] (.*)$/
const BULLET_RE = /^([ \t]*)([-*+]) (.*)$/
const NUMBERED_DOT_RE = /^([ \t]*)(\d+)\. (.*)$/
const NUMBERED_PAREN_RE = /^([ \t]*)(\d+)\) (.*)$/

/**
 * Parse a single line of textarea content for markdown list-item structure.
 *
 * Recognizes bullet (`-`, `*`, `+`), numbered (`<n>. `, `<n>) `), and task
 * (`- [ ]`, `- [x]`) markers, each optionally indented. Returns null for
 * plain prose, headings, code-fence lines, and empty/whitespace-only lines.
 *
 * @param {string} lineText - Single line of content (no trailing newline).
 * @returns {{
 *   leadingWhitespace: string,
 *   marker: string,
 *   markerType: 'bullet' | 'numbered-dot' | 'numbered-paren' | 'task',
 *   numberValue: number | null,
 *   bulletChar: '-' | '*' | '+' | null,
 *   content: string,
 * } | null}
 */
export function parseListLine(lineText) {
  let m = TASK_RE.exec(lineText)
  if (m) {
    const [, leadingWhitespace, bulletChar, checkChar, content] = m
    return {
      leadingWhitespace,
      marker: `${bulletChar} [${checkChar}] `,
      markerType: 'task',
      numberValue: null,
      bulletChar,
      content,
    }
  }

  m = BULLET_RE.exec(lineText)
  if (m) {
    const [, leadingWhitespace, bulletChar, content] = m
    return {
      leadingWhitespace,
      marker: `${bulletChar} `,
      markerType: 'bullet',
      numberValue: null,
      bulletChar,
      content,
    }
  }

  m = NUMBERED_DOT_RE.exec(lineText)
  if (m) {
    const [, leadingWhitespace, numStr, content] = m
    return {
      leadingWhitespace,
      marker: `${numStr}. `,
      markerType: 'numbered-dot',
      numberValue: Number(numStr),
      bulletChar: null,
      content,
    }
  }

  m = NUMBERED_PAREN_RE.exec(lineText)
  if (m) {
    const [, leadingWhitespace, numStr, content] = m
    return {
      leadingWhitespace,
      marker: `${numStr}) `,
      markerType: 'numbered-paren',
      numberValue: Number(numStr),
      bulletChar: null,
      content,
    }
  }

  return null
}

/**
 * Compute the marker for the next list item.
 *
 * Bullets reuse the same character. Numbered markers increment by one and
 * reuse the separator (`.` or `)`). Task markers always render as unchecked,
 * regardless of the prior item's check state.
 *
 * @param {ReturnType<typeof parseListLine>} parsed - Non-null parse result.
 * @returns {string}
 */
export function nextMarker(parsed) {
  switch (parsed.markerType) {
    case 'bullet':
      return `${parsed.bulletChar} `
    case 'task':
      return `${parsed.bulletChar} [ ] `
    case 'numbered-dot':
      return `${parsed.numberValue + 1}. `
    case 'numbered-paren':
      return `${parsed.numberValue + 1}) `
    default:
      return ''
  }
}
