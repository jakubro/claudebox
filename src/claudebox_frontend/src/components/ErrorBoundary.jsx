/** Catches a render error in its subtree and shows a retryable fallback instead of unmounting the app. */

import { Component } from 'react'
import { reportRenderError } from '../utils/errorReporting'

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} props.label - Identifies the boundary in error reports (panel id or "app").
 * @param {*} [props.resetKey] - Clears the caught error when this value changes (e.g. session id).
 */
export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    reportRenderError({ label: this.props.label, error, componentStack: info.componentStack })
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback" data-testid={`error-boundary-${this.props.label}`}>
          <p>This panel stopped responding.</p>
          <button type="button" onClick={this.handleRetry}>
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
