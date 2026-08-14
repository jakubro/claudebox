/** Report a caught render error - console, plus a best-effort record in the daemon log. */

import { reportError } from '../api/errorReport'

/**
 * @param {object} details
 * @param {string} details.label - Which boundary caught it (panel id or "app").
 * @param {Error} details.error - The thrown error.
 * @param {string} [details.componentStack] - React's component stack for the failure.
 */
export function reportRenderError({ label, error, componentStack }) {
  console.error(`ErrorBoundary(${label}): render failed`, error, componentStack)
  reportError({
    kind: 'render-failure',
    message: `${label}: ${error?.message}`,
    stack: componentStack,
  })
}
