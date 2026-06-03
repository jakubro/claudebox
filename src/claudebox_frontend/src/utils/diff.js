/** Diff generation utilities using jsdiff library. */

import { diffLines } from 'diff'

/** Build human-readable summary from diff line counts. */
export function buildDiffSummary(addedCount, removedCount) {
  if (addedCount > 0 && removedCount === 0) {
    return `+${addedCount} line${addedCount > 1 ? 's' : ''}`
  }
  if (removedCount > 0 && addedCount === 0) {
    return `-${removedCount} line${removedCount > 1 ? 's' : ''}`
  }
  if (addedCount > 0 && removedCount > 0) {
    return `+${addedCount}, -${removedCount}`
  }
  return 'No changes'
}

/**
 * Generate a unified diff between old and new strings using jsdiff.
 */
export function generateDiff(oldStr, newStr) {
  const changes = diffLines(oldStr, newStr)

  let addedCount = 0
  let removedCount = 0
  const lines = []

  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, '').split('\n')

    if (change.added) {
      addedCount += change.count || changeLines.length
      for (const line of changeLines) {
        lines.push(`+ ${line}`)
      }
    } else if (change.removed) {
      removedCount += change.count || changeLines.length
      for (const line of changeLines) {
        lines.push(`- ${line}`)
      }
    } else {
      // Context lines (unchanged)
      for (const line of changeLines) {
        lines.push(`  ${line}`)
      }
    }
  }

  return {
    summary: buildDiffSummary(addedCount, removedCount),
    formatted: lines.join('\n'),
  }
}
