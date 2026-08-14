/** Wrap a dockview panel component in an ErrorBoundary keyed to the active session. */

import ErrorBoundary from '../../../components/ErrorBoundary'
import { useSessionRouting } from '../../../context/SessionRoutingContext'
import { shouldInjectPanelThrow } from '../utils/panelThrowInjection'

/**
 * @param {React.ComponentType} Component - The panel component to wrap.
 * @param {string} label - Panel id, used for error reports and the fallback's test id.
 */
export default function withPanelBoundary(Component, label) {
  function PanelWithBoundary(props) {
    const { activeSessionId } = useSessionRouting()

    return (
      <ErrorBoundary label={label} resetKey={activeSessionId}>
        <PanelBody Component={Component} label={label} {...props} />
      </ErrorBoundary>
    )
  }

  PanelWithBoundary.displayName = `WithErrorBoundary(${label})`

  return PanelWithBoundary
}

/**
 * Renders inside the boundary so an injected throw is caught by it, not by an ancestor.
 * @param {object} props
 * @param {React.ComponentType} props.Component - The panel component to render.
 * @param {string} props.label - Panel id, checked against the throw-injection query param.
 */
function PanelBody({ Component, label, ...props }) {
  if (shouldInjectPanelThrow(label)) {
    throw new Error(`Injected failure for panel "${label}" (?throwPanel=${label})`)
  }

  return <Component {...props} />
}
