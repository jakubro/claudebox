/** Single panel row - minimal layout (icon + title; subtitle surfaced via native tooltip). */

/**
 * Render one todo row in the Todos panel.
 *
 * Minimal layout: state icon + title only. The item's `subtitle`, when present,
 * surfaces as a native browser tooltip via `title=` on the row - no inline
 * visible muted line, no count badge. Blocked state is encoded in the icon
 * itself (caller passes the `⊘` glyph when blockers are unresolved).
 *
 * @param {object} props
 * @param {object} props.todo - Todo item carrying content, status, optional subtitle.
 * @param {string} props.icon - Status icon glyph to render before the content.
 */
export default function TodoRow({ todo, icon }) {
  return (
    <div
      className={`todo-item todo-${todo.status}`}
      data-testid="todo-item"
      title={todo.subtitle || undefined}>
      <span className="todo-status">{icon}</span>
      <span className="todo-content">{todo.content}</span>
    </div>
  )
}
