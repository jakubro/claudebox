/** Extract path candidates from text for filesystem resolution. */

/** Common abbreviations that resemble filenames after punctuation stripping. */
const NOT_FILENAMES = new Set(['e.g', 'i.e'])

/** Leading punctuation to strip from candidate paths. */
const LEADING_PUNCT = /^[([*#]+/

/** Trailing punctuation to strip from candidate paths. */
const TRAILING_PUNCT = /[.,)\]:;*]+$/

/** Trailing line:col suffixes from grep-style output (e.g. ":3269:30"). */
const TRAILING_LINE_COL = /(:\d+)+$/

/** Characters stripped from both ends of a token (wrapping punctuation). */
const WRAP_CHARS = new Set(['`', '"', "'"])

/** Characters that never appear in real filesystem paths. */
const PATH_ILLEGAL = /[`'"()[\]{}*?]/

/**
 * Extract path candidates from a text string.
 *
 * Strips surrounding punctuation (backticks, quotes, parens, brackets, asterisks),
 * trailing line:col suffixes, rejects tokens with path-illegal characters.
 *
 * @param {string} text - Input text to scan.
 * @returns {Array<{candidate: string, start: number, end: number}>}
 */
export function extractPathCandidates(text) {
  if (!text) {
    return []
  }

  const results = []
  const regex = /\S+/g
  let match

  while ((match = regex.exec(text)) !== null) {
    let word = match[0]
    let start = match.index

    // Skip URLs
    if (word.startsWith('http://') || word.startsWith('https://')) {
      continue
    }

    // Strip leading/trailing punctuation
    const leadingMatch = word.match(LEADING_PUNCT)
    if (leadingMatch) {
      start += leadingMatch[0].length
      word = word.slice(leadingMatch[0].length)
    }
    word = word.replace(TRAILING_PUNCT, '')
    if (!word) {
      continue
    }

    // Strip leading/trailing wrapping characters (backticks, quotes)
    let ltrim = 0
    while (ltrim < word.length && WRAP_CHARS.has(word[ltrim])) {
      ltrim++
    }
    let rtrim = word.length
    while (rtrim > ltrim && WRAP_CHARS.has(word[rtrim - 1])) {
      rtrim--
    }
    if (ltrim > 0 || rtrim < word.length) {
      start += ltrim
      word = word.slice(ltrim, rtrim)
    }
    if (!word) {
      continue
    }

    // Strip trailing line:col suffixes (e.g. ":3269:30" from grep output)
    word = word.replace(TRAILING_LINE_COL, '')
    if (!word) {
      continue
    }

    const end = start + word.length

    // Skip XML/HTML tags (e.g. "<command-message>scope</command-message>")
    if (word.includes('<') || word.includes('>')) {
      continue
    }

    // Skip colon-containing strings — not paths (e.g. "qdr:h/d/w/m/y")
    if (word.includes(':')) {
      continue
    }

    // Skip tokens with no alphanumeric content (e.g. "//")
    if (!/[a-z0-9]/i.test(word)) {
      continue
    }

    // Skip tokens containing characters illegal in filesystem paths
    if (PATH_ILLEGAL.test(word)) {
      continue
    }

    // Accept if contains "/" (path separator) or has file-like extension
    const hasSlash = word.includes('/')
    const hasExtension = looksLikeFilename(word)

    if (hasSlash || hasExtension) {
      results.push({ candidate: word, start, end })
    }
  }

  return results
}

/**
 * Collect unique candidate strings from extraction results.
 * @param {Array<{candidate: string}>} extractions
 * @returns {string[]}
 */
export function uniqueCandidates(extractions) {
  return [...new Set(extractions.map(e => e.candidate))]
}

/**
 * Resolve a path candidate to an absolute host path.
 * Handles /tmp → sessionDir mapping and explicit resolved path lookup.
 * @param {string} candidate - Path candidate string.
 * @param {string|null} sessionDir - Host session directory for /tmp resolution.
 * @param {Object<string, string>} resolvedPaths - Map of candidate → resolved path.
 * @returns {string|null} Resolved absolute path, or null if unresolvable.
 */
export function resolvePathCandidate(candidate, sessionDir, resolvedPaths) {
  if ((candidate === '/tmp' || candidate.startsWith('/tmp/')) && sessionDir) {
    return `${sessionDir}${candidate}`
  }
  if (resolvedPaths?.[candidate]) {
    return resolvedPaths[candidate]
  }
  return null
}

/**
 * Check if a word looks like a filename (has 1-5 alpha-char extension after last dot).
 * @param {string} word
 * @returns {boolean}
 */
function looksLikeFilename(word) {
  const dotIdx = word.lastIndexOf('.')
  if (dotIdx < 1) {
    return false
  }
  const ext = word.slice(dotIdx + 1)
  return /^[a-z]{1,5}$/i.test(ext) && !NOT_FILENAMES.has(word.toLowerCase())
}
