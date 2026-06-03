/** Parsers that convert raw tool output strings into CodeBlock line arrays. */

import { getBasename } from '../../../../../../../../../../../../../utils/formatters'
import { parseGrepLine } from '../../../../../../../../../../../../../utils/parsers'

/**
 * Parse Read/Write tool output into CodeBlock lines.
 */
export function parseReadWriteLines(details) {
  return details.split('\n').map(line => {
    const match = line.match(/^\s*(\d+)[→│\t](.*)$/)
    if (match) {
      return { type: 'normal', lineNum: parseInt(match[1], 10), content: match[2] }
    }
    return { type: 'normal', content: line }
  })
}

/**
 * Parse Grep tool output into CodeBlock lines with mode metadata.
 */
export function parseGrepLines(details, outputMode, showFullPaths) {
  const rawLines = details.split('\n')
  let parsed = rawLines.map(line => parseGrepLine(line, outputMode))

  const isFilesOnly = !parsed.some(p => p.type === 'result')
  const isMultiFile = parsed.some(p => p.type === 'result' && p.file)

  // Strip "Found N files" summary for files-only output
  if (isFilesOnly && parsed[0]?.type === 'plain' && /^Found \d+ files?$/.test(parsed[0].content)) {
    parsed = parsed.slice(1)
  }

  const lines = parsed.map(p => {
    if (p.type === 'separator') {
      return { type: 'separator' }
    }
    if (p.type === 'result') {
      return {
        type: p.isMatch ? 'match' : 'context',
        lineNum: p.lineNum != null ? parseInt(p.lineNum, 10) : undefined,
        file: p.file ? (showFullPaths ? p.file : getBasename(p.file)) : undefined,
        filePath: p.file || undefined,
        content: p.content,
      }
    }
    if (p.type === 'file') {
      return { type: 'normal', content: p.path }
    }
    return { type: 'normal', content: p.content }
  })

  return { lines, isMultiFile, isFilesOnly }
}

/**
 * Parse Edit tool diff output into CodeBlock lines.
 *
 * Paired diff lines include oldLine/newLine for inline diff rendering.
 * Sequential line numbers track old-side position through the diff.
 */
export function parseEditLines(details, startLine = 1) {
  const rawLines = details.split('\n')
  const result = []
  let lineNum = startLine

  for (let i = 0; i < rawLines.length; ) {
    const line = rawLines[i]

    if (line.startsWith('- ')) {
      // Collect consecutive remove lines
      const removeLines = []
      while (i < rawLines.length && rawLines[i].startsWith('- ')) {
        removeLines.push(rawLines[i].slice(2))
        i++
      }
      // Collect consecutive add lines
      const addLines = []
      while (i < rawLines.length && rawLines[i].startsWith('+ ')) {
        addLines.push(rawLines[i].slice(2))
        i++
      }
      // Paired lines carry oldLine/newLine for inline diff rendering
      const maxLen = Math.max(removeLines.length, addLines.length)
      for (let j = 0; j < maxLen; j++) {
        if (j < removeLines.length && j < addLines.length) {
          result.push({
            type: 'diff-remove',
            lineNum: lineNum++,
            content: removeLines[j],
            oldLine: removeLines[j],
            newLine: addLines[j],
          })
          result.push({
            type: 'diff-add',
            content: addLines[j],
            oldLine: removeLines[j],
            newLine: addLines[j],
          })
        } else if (j < removeLines.length) {
          result.push({ type: 'diff-remove', lineNum: lineNum++, content: removeLines[j] })
        } else {
          result.push({ type: 'diff-add', content: addLines[j] })
        }
      }
    } else if (line.startsWith('+ ')) {
      // Orphan add (no preceding remove)
      result.push({ type: 'diff-add', content: line.slice(2) })
      i++
    } else if (line.startsWith('· ')) {
      result.push({ type: 'separator' })
      i++
    } else {
      // Context line — strip 2-char indent prefix if present
      result.push({
        type: 'diff-context',
        lineNum: lineNum++,
        content: line.startsWith('  ') ? line.slice(2) : line,
      })
      i++
    }
  }

  return result
}
