/** Container with left border indentation for nested content. */

/**
 * Render a container with left border indentation matching tool-nested pattern.
 * @param {Object} props
 * @param {React.ReactNode} props.children - Content to render inside.
 * @param {string} [props.className] - Additional CSS class.
 */
export default function NestedContent({ children, className = '' }) {
  return <div className={`nested-content ${className}`.trim()}>{children}</div>
}
