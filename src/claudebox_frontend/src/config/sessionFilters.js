/** Sessions-panel filter identifiers - shared by SessionsContext and the panel's own tree utils. */

// Threads match SessionMetadata.is_side_thread. Subsessions match nothing: the panel does not
// read the spawn lineage the session payload carries.
export const SESSION_FILTERS = Object.freeze({
  CONVERSATIONS: 'conversations',
  NAMED: 'named',
  PINNED: 'pinned',
  THREADS: 'threads',
  SUBSESSIONS: 'subsessions',
  ALL: 'all',
})
