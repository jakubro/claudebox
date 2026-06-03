/** Footer pill showing the active runtime's display name. */

import useCapabilities from '../../../hooks/useCapabilities'

/**
 * Render the active runtime's display name with leading separator.
 *
 * Renders nothing during the capability-data race so the footer doesn't
 * flash an empty pill (and doesn't leave a doubled separator) before
 * the runtime resolves.
 */
export default function RuntimeIdentityPill() {
  const { runtimeName } = useCapabilities()
  if (!runtimeName) {
    return null
  }
  return (
    <>
      <span className="footer-sep">|</span>
      <span
        className="footer-item footer-runtime-pill"
        title={`Runtime — ${runtimeName}`}
        data-testid="footer-runtime">
        {runtimeName}
      </span>
    </>
  )
}
