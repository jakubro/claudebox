/** Read-only footer pill naming the settings bundle the session started under. */

import { useSessionData } from '../../../context/SessionDataContext'
import useSessionDefaults from '../../../hooks/useSessionDefaults'
import { driftedKeys } from './bundleDrift'

/**
 * Bundle name with leading separator and a dot once a value the bundle set has changed since;
 * renders nothing for an unbundled session. Reports, never offers - a bundle cannot be changed.
 */
export default function BundlePill() {
  const { bundle, sessionData } = useSessionData()
  const sessionDefaults = useSessionDefaults()
  if (!bundle) {
    return null
  }

  const entry = sessionDefaults?.bundles?.[bundle]
  const declared = entry?.declared ?? {}
  const drifted = driftedKeys(declared, sessionData)
  const settings = Object.entries(declared).map(([key, value]) => `${key}: ${value}`)
  const other = (entry?.keys ?? []).filter(key => !(key in declared))
  const tooltip = [
    `Bundle — ${bundle}`,
    ...settings,
    ...(other.length > 0 ? [`also sets: ${other.join(', ')}`] : []),
    ...(drifted.length > 0 ? [`changed since: ${drifted.join(', ')}`] : []),
  ].join('\n')

  return (
    <>
      <span className="footer-sep">|</span>
      <span className="footer-bundle-pill" title={tooltip} data-testid="footer-bundle">
        <span className="footer-bundle-name">{bundle}</span>
        {drifted.length > 0 && (
          <span className="footer-bundle-drift" data-testid="footer-bundle-drift" />
        )}
      </span>
    </>
  )
}
