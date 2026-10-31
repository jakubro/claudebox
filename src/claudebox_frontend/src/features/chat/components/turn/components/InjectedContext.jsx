/** The corner triangle a block shows for text the agent received that no one wrote, and its box. */

import { useMemo, useState } from 'react'
import { deduplicateWithCounts } from '../../../../../utils/collections'
import { InjectedSource } from '../../../../../utils/eventProcessing'
import { injectedSourceLabel, injectedSourcesTitle } from '../utils/injectedContext'

/**
 * Drawn at the end of its host's row; the open box takes the row's next line, full width.
 * @param {object} props
 * @param {Array<{source: string, text: string}>|null} props.entries - In order; none draws nothing.
 */
export default function InjectedContext({ entries }) {
  const [open, setOpen] = useState(false)
  const repeats = useMemo(
    () =>
      deduplicateWithCounts(
        (entries ?? []).map((entry, i) =>
          JSON.stringify(
            entry.source === InjectedSource.SYSTEM_REMINDER
              ? [entry.source, entry.text]
              : [entry.source, entry.text, i],
          ),
        ),
      ),
    [entries],
  )

  if (repeats.length === 0) {
    return null
  }

  return (
    <>
      <button
        type="button"
        className={`injected-context-toggle${open ? ' open' : ''}`}
        title={injectedSourcesTitle(entries)}
        aria-expanded={open}
        onClick={event => {
          event.stopPropagation()
          setOpen(prev => !prev)
        }}
        data-testid="injected-context-toggle"
      />
      {open && (
        <div
          className="injected-context-box"
          onClick={event => event.stopPropagation()}
          data-testid="injected-context-box">
          {repeats.map(({ item, count }) => {
            const [source, text] = JSON.parse(item)
            return (
              <div key={item} className="injected-context-entry">
                <div className="injected-context-source">
                  {injectedSourceLabel(source)}
                  {count > 1 && <span className="injected-context-count">×{count}</span>}
                </div>
                <div className="injected-context-text">{text}</div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
