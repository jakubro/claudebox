/** Pending message reconciliation utilities. */

import { parseSlashCommand } from '../../../utils/parsers'

/**
 * Build set of delivered content strings from human events after a timestamp.
 */
export function getDeliveredContents(humanEvents, afterTimestamp) {
  const delivered = new Set()
  for (const event of humanEvents) {
    if (event.timestamp > afterTimestamp) {
      delivered.add(event.content)
      const parsed = parseSlashCommand(event.content)
      if (parsed) {
        delivered.add(parsed.cmd + (parsed.args ? ` ${parsed.args}` : ''))
      }
    }
  }
  return delivered
}

/**
 * Check if pending content matches any delivered content.
 * Handles whitespace normalization for slash commands with multi-line args.
 */
export function isDelivered(delivered, content) {
  if (delivered.has(content)) {
    return true
  }
  // Normalize: collapse whitespace between /command and args
  const normalized = content.replace(/^(\/\S+)\s+/, '$1 ').trim()
  return normalized !== content && delivered.has(normalized)
}
