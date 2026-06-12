/** Command detail block - usage, description, and metadata for a single slash command. */

/**
 * Render the description / usage / metadata section for a slash command.
 * Returns `null` when the command has no description (consumer suppresses
 * the surrounding container).
 *
 * Reused by the chat-input autocomplete dropdown's right panel and the
 * user-message hover card. CSS classes (`.autocomplete-detail*`) are shared
 * via `CommandAutocomplete.css`.
 *
 * @param {object} props
 * @param {object} props.command - `{name, usage?, description?, model?, effort?, context?}`.
 */
export default function CommandDetailPanel({ command }) {
  if (!command?.description) {
    return null
  }
  return (
    <div className="autocomplete-detail">
      {command.usage && <div className="autocomplete-detail-usage">{command.usage}</div>}
      <div className="autocomplete-detail-desc">{command.description}</div>
      {(command.model || command.effort || command.context) && (
        <div className="autocomplete-detail-meta">
          {[
            command.model && `model: ${command.model}`,
            command.effort && `effort: ${command.effort}`,
            command.context,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      )}
    </div>
  )
}
