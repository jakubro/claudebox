/** Hover strip at the top-right of the hovered top-level part of a message, copying that part's markdown. */

import { Bookmark } from 'lucide-react'
import { useEffect, useState } from 'react'
import CopyButton from '../../../../../components/CopyButton.jsx'
import { partCopyText, stripPlacement } from '../utils/blockStrip'

const NO_STRIP = new Set(['PRE', 'HR'])

/**
 * @param {string} props.content - The markdown the parts were rendered from
 * @param {{current: HTMLElement|null}} props.containerRef - The text block holding the parts
 * @param {{isActive: function(number): boolean, toggle: function(number, string)}|null} props.bookmark
 *   - Bookmarks a part by its ordinal; absent where parts cannot be bookmarked.
 */
export default function BlockStrip({ content, containerRef, bookmark = null }) {
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const onOver = event => {
      const part = event.target.closest?.('[data-md-block]')
      if (!part || part.parentElement !== container) {
        return
      }
      setHovered(NO_STRIP.has(part.tagName) || part.dataset.mdStart === undefined ? null : part)
    }
    const onLeave = () => setHovered(null)
    container.addEventListener('pointerover', onOver)
    container.addEventListener('pointerleave', onLeave)
    return () => {
      container.removeEventListener('pointerover', onOver)
      container.removeEventListener('pointerleave', onLeave)
    }
  }, [containerRef])

  const placement = hovered && stripPlacement(hovered, containerRef.current)

  return (
    <div
      className="block-strip"
      data-testid="block-strip"
      style={placement ?? { display: 'none' }}
      onClick={e => e.stopPropagation()}>
      {hovered && bookmark && (
        <PartBookmarkButton
          active={bookmark.isActive(Number(hovered.dataset.mdBlock))}
          onClick={() =>
            bookmark.toggle(Number(hovered.dataset.mdBlock), partCopyText(hovered, content))
          }
        />
      )}
      {hovered && (
        <CopyButton
          text={partCopyText(hovered, content)}
          className="block-copy-btn"
          title="Copy paragraph"
          size={12}
        />
      )}
    </div>
  )
}

function PartBookmarkButton({ active, onClick }) {
  return (
    <button
      type="button"
      className={`copy-btn block-bookmark-btn${active ? ' active' : ''}`}
      title={active ? 'Remove bookmark' : 'Bookmark this paragraph'}
      onClick={onClick}>
      <Bookmark size={12} fill={active ? 'currentColor' : 'none'} />
    </button>
  )
}
