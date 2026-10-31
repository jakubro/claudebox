/** Read-modify-write of a JSON array kept in localStorage under a key a live hook may not hold. */

/** Apply `fn` to the stored array (empty when absent); an empty result removes the key. */
export function updateStoredList(key, fn) {
  try {
    const stored = localStorage.getItem(key)
    const next = fn(stored ? JSON.parse(stored) : [])
    if (next.length === 0) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, JSON.stringify(next))
    }
  } catch {
    // Same contract as useLocalStorage's own writes: a failed write loses a convenience, not data.
  }
}
