/** Comparator factory functions for React.memo and equality checking. */

/**
 * Create a props comparator for React.memo. Shallow-compares all props by default;
 * specialCompare supplies per-field overrides.
 * @param {Object.<string, function(any, any): boolean>} specialCompare - Map of prop names to custom comparators
 * @returns {function(Object, Object): boolean}
 */
export function createPropsComparator(specialCompare = {}) {
  return (prev, next) => {
    const allKeys = new Set([...Object.keys(prev), ...Object.keys(next)])

    for (const key of allKeys) {
      if (specialCompare[key]) {
        if (!specialCompare[key](prev[key], next[key])) {
          return false
        }
      } else if (prev[key] !== next[key]) {
        return false
      }
    }

    return true
  }
}

/** Order-independent, null-safe Set equality, for memo() comparators where Set identity churns per render even when contents are stable. */
export function sameIdSet(a, b) {
  if (a === b) {
    return true
  }
  if (!(a && b) || a.size !== b.size) {
    return a === b
  }
  for (const id of a) {
    if (!b.has(id)) {
      return false
    }
  }
  return true
}
