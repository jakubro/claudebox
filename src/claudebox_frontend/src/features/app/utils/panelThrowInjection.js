/** Test-only render-failure injection for the error-boundary repro/e2e coverage (see ErrorBoundary.jsx). */

/**
 * Whether `label`'s panel should throw, via `?throwPanel=<label>`; gated on dev builds or the
 * test-only `window.__claudeboxAllowThrowPanel` flag since e2e/app tests target a production build.
 * Stateless (reads the URL each call): React retries a thrown render once, so a one-shot flag would miss it.
 */
export function shouldInjectPanelThrow(label) {
  if (
    typeof window === 'undefined' ||
    !(import.meta.env.DEV || window.__claudeboxAllowThrowPanel)
  ) {
    return false
  }

  return new URLSearchParams(window.location.search).get('throwPanel') === label
}
