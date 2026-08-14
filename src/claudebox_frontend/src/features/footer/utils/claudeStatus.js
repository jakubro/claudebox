/** Pure transform of status.claude.com payload - extracted from useClaudeStatus.js. */

/**
 * Reduces the status payload to {indicator, description}; appends the first incident name when present.
 *
 * @param {{ status?: {indicator?: string, description?: string}, incidents?: Array<{name?: string}> }} data
 * @returns {{ indicator: string, description: string }}
 */
export function formatClaudeStatusResponse(data) {
  const indicator = data.status?.indicator || 'none'
  const baseDescription = data.status?.description || 'Unknown'

  let description = baseDescription
  if (indicator !== 'none' && data.incidents?.length > 0) {
    const incidentName = data.incidents[0].name
    if (incidentName) {
      description = `${baseDescription} - ${incidentName}`
    }
  }

  return { indicator, description }
}
