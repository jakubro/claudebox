/** Runtime feature switches. */

const LOOKUPS_GROUPING_DEFAULT = false

export function isLookupsGroupingEnabled() {
  if (typeof window === 'undefined') {
    return LOOKUPS_GROUPING_DEFAULT
  }

  return window.__cb_lookups_grouping ?? LOOKUPS_GROUPING_DEFAULT
}
