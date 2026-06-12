/** Two-panel command autocomplete dropdown (IntelliJ-style). */

import { useEffect, useRef } from 'react'
import { CATEGORY_COLORS } from '../../../../../utils/categorize'
import CommandDetailPanel from './CommandDetailPanel'

/**
 * Render a two-panel autocomplete dropdown above the chat textarea.
 *
 * Left panel shows a filtered list of commands with keyboard navigation.
 * Right panel shows the full description of the highlighted command.
 *
 * @param {object} props
 * @param {Array} props.items - Filtered command items [{name, category, usage?, description?}].
 * @param {number} props.selectedIndex - Currently highlighted item index.
 * @param {Function} props.onSelect - Callback when an item is selected.
 */
export default function CommandAutocomplete({ items, selectedIndex, onSelect }) {
  const listRef = useRef(null)

  // Scroll selected item into view
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional - scroll on prop change
  useEffect(() => {
    if (!listRef.current) {
      return
    }
    const active = listRef.current.querySelector('.autocomplete-item-active')
    if (active) {
      active.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  if (items.length === 0) {
    return null
  }

  const highlighted = items[selectedIndex] || items[0]

  return (
    <div className="command-autocomplete" data-testid="command-autocomplete">
      <div className="autocomplete-list" ref={listRef}>
        {items.map((item, i) => (
          <div
            key={item.name}
            className={`autocomplete-item${i === selectedIndex ? ' autocomplete-item-active' : ''}`}
            onMouseDown={e => {
              e.preventDefault()
              onSelect(item)
            }}
            onMouseEnter={() => {}}>
            <span
              className="autocomplete-dot"
              style={{ color: CATEGORY_COLORS[item.category] || CATEGORY_COLORS.custom }}>
              ●
            </span>
            <span className="autocomplete-name">/{item.name}</span>
          </div>
        ))}
      </div>
      <CommandDetailPanel command={highlighted} />
    </div>
  )
}
