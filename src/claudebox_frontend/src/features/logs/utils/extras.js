/** Pure helpers for rendering log-line `extra` payloads as inline pills. */

/**
 * Flatten an extras object into an ordered list of `{key, value}` pill descriptors.
 *
 * Skips `exception` (rendered separately as a traceback). Plain-object values are
 * shallow-flattened one level, so `session: {id, workspace}` yields two pairs
 * keyed `session.id` and `session.workspace`. Arrays and primitives stay as-is.
 *
 * @param {object | null | undefined} extra - Extras payload from a log entry.
 * @returns {{key: string, value: unknown}[]} Ordered list of pill descriptors.
 */
export function flattenExtras(extra) {
  if (!extra || typeof extra !== 'object') {
    return []
  }
  const pairs = []
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'exception') {
      continue
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      for (const [nk, nv] of Object.entries(v)) {
        pairs.push({ key: `${k}.${nk}`, value: nv })
      }
    } else {
      pairs.push({ key: k, value: v })
    }
  }
  return pairs
}

/** Format a pill value: strings quoted, primitives plain, objects JSON-stringified. */
export function formatPillValue(v) {
  if (typeof v === 'string') {
    return `"${v}"`
  }
  if (v === null) {
    return 'null'
  }
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}
