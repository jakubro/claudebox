/** An assistant text block: markdown with a per-part hover strip, or local command output with a copy button. */

import { useMemo, useRef } from 'react'
import CopyButton from '../../../../../components/CopyButton.jsx'
import Markdown from '../../../../../components/Markdown'
import { useSessionWorkspace } from '../../../../../context/SessionDataContext'
import { paragraphBookmarkKey, parseTail } from '../../../../../utils/bookmarkIds'
import { useTurn } from '../hooks/useTurn'
import BlockStrip from './BlockStrip'
import InjectedContext from './InjectedContext'
import LocalCommandBlock from './LocalCommandBlock'

const LOCAL_COMMAND = /^<local-command-(stdout|stderr)>([\s\S]*)<\/local-command-\1>$/

/**
 * @param {string} props.content - The block's text, system reminders already stripped
 * @param {string} [props.eventId] - The text event the block was cut from
 * @param {number} props.segment - The block's ordinal among the text blocks cut from that event
 * @param {Array} [props.injected] - Text no one wrote that the agent received in or after this block
 */
export default function TurnTextBlock({ content, eventId, segment, injected = null }) {
  const containerRef = useRef(null)
  const { turnId, bookmarkedParts, onToggleBookmark } = useTurn()
  const workspaceDir = useSessionWorkspace()
  const command = content.match(LOCAL_COMMAND)
  const textId = eventId ? `${eventId}-${segment}` : null

  const markedKey = [...(bookmarkedParts ?? [])]
    .map(parseTail)
    .filter(t => t?.kind === 'paragraph' && t.textId === textId)
    .map(t => t.block)
    .sort((a, b) => a - b)
    .join(',')
  const markedBlocks = useMemo(
    () => (markedKey ? markedKey.split(',').map(Number) : null),
    [markedKey],
  )

  const bookmark = useMemo(() => {
    if (!(turnId && onToggleBookmark && paragraphBookmarkKey(eventId, segment, 0))) {
      return null
    }
    return {
      isActive: block => bookmarkedParts?.has(paragraphBookmarkKey(eventId, segment, block)),
      toggle: (block, preview) =>
        onToggleBookmark(turnId, paragraphBookmarkKey(eventId, segment, block), preview),
    }
  }, [turnId, onToggleBookmark, bookmarkedParts, eventId, segment])

  return (
    <div className="turn-text" ref={containerRef} data-text-id={textId ?? undefined}>
      {command ? (
        <LocalCommandBlock type={command[1]} content={command[2].trim()} />
      ) : (
        <Markdown hostsBlockActions markedBlocks={markedBlocks} baseDir={workspaceDir}>
          {content}
        </Markdown>
      )}
      {command && (
        <CopyButton
          text={content}
          className="local-command-copy-btn"
          title="Copy message"
          size={12}
        />
      )}
      {!command && <BlockStrip content={content} containerRef={containerRef} bookmark={bookmark} />}
      {injected?.length > 0 && (
        <div className="injected-context-corner">
          <InjectedContext entries={injected} />
        </div>
      )}
    </div>
  )
}
