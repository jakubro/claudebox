/** Pure helper: format a non-zero bucket count map as the Todos chrome summary. */

// Header subtitle bucket order: blocked sits between in_progress and pending so counts read the
// natural progression (done -> working -> blocked -> todo -> dropped).
const HEADER_BUCKETS = ['completed', 'in_progress', 'blocked', 'pending', 'removed']

/**
 * Builds the Todos chrome summary string (`iconN iconN ...`) for non-zero buckets, in canonical
 * header order.
 * @param {Object<string, number>} counts - Per-bucket count map.
 * @param {Object<string, string>} icons - Bucket name -> glyph map.
 * @returns {string} Space-joined `glyphN` pairs.
 */
export function formatCounts(counts, icons) {
  return HEADER_BUCKETS.filter(b => counts[b])
    .map(b => `${icons[b]}${counts[b]}`)
    .join(' ')
}
