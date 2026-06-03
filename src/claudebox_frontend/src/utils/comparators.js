/** Comparator factory functions for React.memo and equality checking. */

/**
 * Create a props comparator for React.memo with support for custom field comparisons.
 *
 * By default, performs shallow equality (===) on all props.
 * Use specialCompare map to provide custom comparison functions for specific fields.
 *
 * @param {Object.<string, function(any, any): boolean>} specialCompare - Map of prop names to custom comparators
 * @returns {function(Object, Object): boolean} - Comparator function for React.memo
 *
 * @example
 * // Simple usage - shallow compare all props
 * export default memo(MyComponent, createPropsComparator())
 *
 * @example
 * // With custom comparison for arrays
 * export default memo(MyComponent, createPropsComparator({
 *   items: (a, b) => a.length === b.length,
 *   events: (a, b) => a.length === b.length &&
 *     (a.length === 0 || a[a.length-1].timestamp === b[b.length-1].timestamp)
 * }))
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

/**
 * Compare two ID Sets for member equality (order-independent, null-safe).
 *
 * Returns true when both are the same reference, both are null/undefined,
 * or both hold exactly the same set of ids. Designed for memo() comparators
 * where the Set identity churns per render but contents are usually stable.
 */
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
