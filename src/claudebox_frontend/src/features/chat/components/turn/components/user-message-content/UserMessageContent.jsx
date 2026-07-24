/** Parse and render user messages with slash commands, Q/A, command output, and attachments. */

import { useMemo } from 'react'
import PathHighlighter from '../../../../../../components/PathHighlighter'
import { useSessionDir } from '../../../../../../context/SessionDataContext'
import usePathResolution from '../../../../../../hooks/usePathResolution'
import { parseLocalCommandOutput, parseSlashCommand } from '../../../../../../utils/parsers'
import { extractPathCandidates, uniqueCandidates } from '../../../../../../utils/pathCandidates'
import LocalCommandBlock from '../LocalCommandBlock'
import AttachmentThumbnails from './components/AttachmentThumbnails'
import InlineReplies from './components/InlineReplies'
import QAResponseBlock from './components/QAResponseBlock'
import SlashCommandToken from './SlashCommandToken'

/**
 * Render user message content with slash commands, local command output, Q/A blocks,
 * and attachment thumbnails.
 * @param {object} props
 * @param {string} props.message - Raw message text to parse and render.
 * @param {Array} props.attachments - Optional array of attachment metadata.
 * @param {Array} props.inlineReplies - Optional array of inline reply pairs (quote/from/response).
 */
export default function UserMessageContent({ message, attachments, inlineReplies }) {
  const sessionDir = useSessionDir()
  const candidates = useMemo(() => uniqueCandidates(extractPathCandidates(message)), [message])
  const resolvedPaths = usePathResolution(candidates)
  const attachmentRow =
    attachments?.length > 0 ? <AttachmentThumbnails attachments={attachments} /> : null
  const inlineRepliesRow =
    inlineReplies?.length > 0 ? <InlineReplies replies={inlineReplies} /> : null

  // Content-only send (attachments and/or inline replies with an empty composer):
  // render just the rows, with no empty message box. Covers all branches below.
  const hasText = !!message?.trim()
  if (!hasText) {
    return (
      <>
        {attachmentRow}
        {inlineRepliesRow}
      </>
    )
  }

  // First check for slash command
  const parsed = parseSlashCommand(message)
  if (parsed) {
    return (
      <>
        <span className="message-content">
          <SlashCommandToken cmd={parsed.cmd} />
          {parsed.args && <> {parsed.args}</>}
        </span>
        {attachmentRow}
        {inlineRepliesRow}
      </>
    )
  }

  // Parse local command output tags
  const segments = parseLocalCommandOutput(message)

  // If single text segment with no local command output, render simple
  if (segments.length === 1 && segments[0].type === 'text') {
    return (
      <>
        <span className="message-content">
          <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
            {segments[0].content}
          </PathHighlighter>
        </span>
        {attachmentRow}
        {inlineRepliesRow}
      </>
    )
  }

  // Render mixed content with local command blocks and answer responses
  return (
    <>
      <div className="message-content message-content-with-commands">
        {segments.map((segment, i) => {
          if (segment.type === 'text') {
            return (
              <span key={i}>
                <PathHighlighter sessionDir={sessionDir} resolvedPaths={resolvedPaths}>
                  {segment.content}
                </PathHighlighter>
              </span>
            )
          }
          if (segment.type === 'qa') {
            return <QAResponseBlock key={i} questions={segment.questions} />
          }
          return <LocalCommandBlock key={i} type={segment.type} content={segment.content} />
        })}
      </div>
      {attachmentRow}
      {inlineRepliesRow}
    </>
  )
}
