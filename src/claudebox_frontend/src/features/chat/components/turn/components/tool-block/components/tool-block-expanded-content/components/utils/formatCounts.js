/** Pure helper: format a non-zero bucket count map as the Todos chrome summary. */

// Header subtitle bucket order: blocked sits between in_progress and pending so counts read the
// natural progression (done -> working -> blocked -> todo -> dropped).
const HEADER_BUCKETS = ['completed', 'in_progress', 'blocked', 'pending', 'removed']

// Two distinct space characters: the line doubles as its own hover title, so a CSS gap is out and
// ordinary spaces would collapse. Exported so the lone-TodoWrite summary reuses the inner gap.
export const PAIR_GAP = ' ' // thin space - inside a pair, between icon and count
const GROUP_GAP = ' ' // ordinary space - between pairs

/**
 * Builds the Todos chrome summary string (`icon countN icon countN ...`) for non-zero buckets, in
 * canonical header order.
 * @param {Object<string, number>} counts - Per-bucket count map.
 * @param {Object<string, string>} icons - Bucket name -> glyph map.
 * @returns {string} Pairs joined by an ordinary space, each pair's own icon and count joined by a
 *   narrower one.
 */
export function formatCounts(counts, icons) {
  return HEADER_BUCKETS.filter(b => counts[b])
    .map(b => `${icons[b]}${PAIR_GAP}${counts[b]}`)
    .join(GROUP_GAP)
}
