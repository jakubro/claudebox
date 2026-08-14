/** Container with left border indentation for nested content. */

/**
 * @param {React.ReactNode} props.children - Content to indent.
 * @param {string} [props.className] - Additional class names.
 */
export default function NestedContent({ children, className = '' }) {
  return <div className={`nested-content ${className}`.trim()}>{children}</div>
}
