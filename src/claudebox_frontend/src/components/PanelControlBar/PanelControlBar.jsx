/** Shared 24px control bar - outer chrome for chat, board, and other panels. */

/**
 * Children are flex items (typically `.panel-control-group` wrappers).
 * Panels fill in their own buttons, styled via the shared `.panel-control-btn` class.
 *
 * With `splitRatio` given, the bar divides at that ratio - `children` left, `rightContent` right -
 * so the division lands at the same x as a content area split the same way.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children - Control groups (flex children) for the left half.
 * @param {string} [props.className] - Additional class on the bar root.
 * @param {number} [props.splitRatio] - Left half's share, 0-1; omit for an undivided bar.
 * @param {React.ReactNode} [props.rightContent] - Control groups for the right half.
 */
export default function PanelControlBar({ children, className = '', splitRatio, rightContent }) {
  if (splitRatio == null) {
    return <div className={`panel-control-bar ${className}`.trim()}>{children}</div>
  }
  return (
    <div className={`panel-control-bar panel-control-bar-split ${className}`.trim()}>
      <div
        className="panel-control-bar-half panel-control-bar-left"
        style={{ flexBasis: `${(splitRatio * 100).toFixed(4)}%` }}>
        {children}
      </div>
      <div className="panel-control-bar-divider-spacer" />
      <div className="panel-control-bar-half panel-control-bar-right">{rightContent}</div>
    </div>
  )
}
