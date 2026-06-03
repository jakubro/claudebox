/** Copyable text extraction from tool output by stripping line numbers and formatting. */

import { getToolConfig } from '../../../../../../../../../../../config/toolRegistry'

/**
 * Extract copyable text from tool output by stripping line numbers and formatting.
 *
 * @param {string} toolName - Read, Write, Edit, etc.
 * @param {string} details - Raw tool output to process.
 * @returns {string} Clean text suitable for clipboard copying.
 */
export function getCopyableText(toolName, details) {
  const config = getToolConfig(toolName)
  if (config.copyableExtractor) {
    return config.copyableExtractor(details)
  }
  return details
}

/** Extract the first line number from Read/Write output for gutter offset. */
export function extractStartingLineNumber(details) {
  const match = details.match(/^\s*(\d+)[→│\t]/)
  return match ? parseInt(match[1], 10) : 1
}

/** Extract raw code from Read/Write output by stripping line number prefixes. */
export function extractCodeFromReadOutput(details) {
  const lines = details.split('\n')
  return lines
    .map(line => {
      const match = line.match(/^\s*\d+[→│\t](.*)$/)
      return match ? match[1] : line
    })
    .join('\n')
}

/** Extract copyable text from Edit output by stripping diff prefixes. */
export function extractEditCopyableText(details) {
  return details
    .split('\n')
    .map(line => {
      if (line.startsWith('- ') || line.startsWith('+ ')) {
        return line.slice(2)
      }
      if (line.startsWith('· ')) {
        return ''
      }
      return line
    })
    .filter(line => line !== '')
    .join('\n')
}
