/** Pure max-finding loop for CodeBlock gutter sizing — no React APIs. */

/**
 * Compute the widest file label and line-number widths in a set of code lines.
 *
 * @param {Array<{file?: string, lineNum?: number | null}> | null | undefined} lines
 * @returns {{ maxFileLen: number, maxLineNumLen: number }}
 */
export function computeColumnWidths(lines) {
  if (!lines || lines.length === 0) {
    return { maxFileLen: 0, maxLineNumLen: 1 }
  }
  let maxFile = 0
  let maxLineNum = 0
  for (const line of lines) {
    if (line.file) {
      maxFile = Math.max(maxFile, line.file.length)
    }
    if (line.lineNum != null) {
      maxLineNum = Math.max(maxLineNum, String(line.lineNum).length)
    }
  }
  return { maxFileLen: maxFile, maxLineNumLen: Math.max(maxLineNum, 4) }
}
