/** Shared 24px control bar - outer chrome for chat, board, and other panels. */

/**
 * Render a horizontal control bar with shared 24px chrome.
 * Children are flex items (typically `.panel-control-group` wrappers); panels
 * fill in their own buttons styled via the shared `.panel-control-btn` class.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Control groups (flex children).
 * @param {string} [props.className] - Additional class on the bar root.
 */
export default function PanelControlBar({ children, className = '' }) {
  return <div className={`panel-control-bar ${className}`.trim()}>{children}</div>
}
