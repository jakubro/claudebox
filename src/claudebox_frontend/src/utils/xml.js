/** XML escape/unescape utilities for structured content handling. */

/** Escape special XML characters in string. */
export function escapeXml(str) {
  if (!str) {
    return ''
  }
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Unescape XML entities back to original characters. */
export function unescapeXml(str) {
  if (!str) {
    return ''
  }
  return str
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
}
