/** What clicking a highlighted path does: copy it, or with Alt open it in the configured editor. */

import { PATH_COPIED_FEEDBACK_MS } from '../config/timing'
import { resolveEditorUrl } from './editorUrl'

/** Hover title for a path: the path, plus the Alt+Click hint when an editor is configured. */
export function pathTitle(path, editorTemplate) {
  return editorTemplate ? `${path}\nAlt+Click to open in editor` : path
}

/**
 * Alt+Click opens `path` in the editor when a template is set; any other click copies it and
 * flashes `copied` on the clicked element. A path carries no line, so the editor opens line 1.
 */
export function handlePathClick(event, path, editorTemplate) {
  const editorUrl = event.altKey ? resolveEditorUrl(editorTemplate, { path }) : null
  event.preventDefault()
  if (editorUrl) {
    window.open(editorUrl, '_blank', 'noopener,noreferrer')
    return
  }
  navigator.clipboard.writeText(path)
  const el = event.currentTarget
  el.classList.add('copied')
  setTimeout(() => el.classList.remove('copied'), PATH_COPIED_FEEDBACK_MS)
}
