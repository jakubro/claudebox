/** Pure resolution of a workspace's "open in editor" URI template. */

/**
 * Substitutes `{path}` and `{line}` into an editor URI template, encoding each value so the
 * template's structural characters (`?`, `&`, `=`) survive. Other placeholders are left
 * untouched; returns null when no template is configured.
 * @param {string | null} template - e.g. `"vscode://file/{path}:{line}"`.
 * @param {{ path: string, line?: number | null }} target
 * @returns {string | null}
 */
export function resolveEditorUrl(template, { path, line }) {
  if (!template) {
    return null
  }
  return template
    .replaceAll('{path}', encodeURIComponent(path))
    .replaceAll('{line}', encodeURIComponent(line ?? 1))
}
