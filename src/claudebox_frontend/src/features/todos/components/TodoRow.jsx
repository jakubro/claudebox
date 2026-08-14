/** Single panel row - minimal layout (icon + title; subtitle surfaced via native tooltip). */

/**
 * Blocked state lives in the icon glyph the caller passes - no separate blocked prop.
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
