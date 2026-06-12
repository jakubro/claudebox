/** Pure path-highlight resolver - extracted from PathHighlighter.jsx, no React APIs. */

import { extractPathCandidates, resolvePathCandidate } from './pathCandidates'

/**
 * Resolve every path candidate in a string, dropping unresolvable ones.
 *
 * @param {string} text
 * @param {string | null} sessionDir
 * @param {Object<string, string>} resolvedPaths - Candidate -> absolute host path.
 * @returns {Array<{start: number, end: number, candidate: string, resolved: string}>}
 */
export function computeHighlights(text, sessionDir, resolvedPaths) {
  const extractions = extractPathCandidates(text)
  const highlights = []
  for (const { candidate, start, end } of extractions) {
    const resolved = resolvePathCandidate(candidate, sessionDir, resolvedPaths)
    if (resolved) {
      highlights.push({ start, end, candidate, resolved })
    }
  }
  return highlights
}
