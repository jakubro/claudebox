/** Parse and render user messages with slash commands, Q/A, command output, and attachments. */

import { useMemo } from 'react'
import PathHighlighter from '../../../../../../components/PathHighlighter'
import { useSessionDir } from '../../../../../../context/SessionDataContext'
import useEditorTemplate from '../../../../../../hooks/useEditorTemplate'
import usePathResolution from '../../../../../../hooks/usePathResolution'
import { parseLocalCommandOutput, parseSlashCommand } from '../../../../../../utils/parsers'
import { extractPathCandidates, uniqueCandidates } from '../../../../../../utils/pathCandidates'
import LocalCommandBlock from '../LocalCommandBlock'
import AttachmentThumbnails from './components/AttachmentThumbnails'
import InlineReplies from './components/InlineReplies'
import QAResponseBlock from './components/QAResponseBlock'
import SlashCommandToken from './SlashCommandToken'

/**
 * @param {Array} props.inlineReplies - Inline reply pairs (quote/from/response).
 * @param {string} [props.note] - Message typed alongside an AskUserQuestion/ExitPlanMode answer.
 */
export default function UserMessageContent({ message, attachments, inlineReplies, note }) {
  const sessionDir = useSessionDir()
  const editorTemplate = useEditorTemplate()
  const candidates = useMemo(() => uniqueCandidates(extractPathCandidates(message)), [message])
  const resolvedPaths = usePathResolution(candidates)
  const noteRow = note?.trim() ? <p className="message-note">{note}</p> : null
  const attachmentRow =
    attachments?.length > 0 ? <AttachmentThumbnails attachments={attachments} /> : null
  const inlineRepliesRow =
    inlineReplies?.length > 0 ? <InlineReplies replies={inlineReplies} /> : null

  // Content-only send (attachments/replies, no text): skip the empty message box.
  const hasText = !!message?.trim()
  if (!hasText) {
    return (
      <>
        {noteRow}
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
        {noteRow}
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
        {noteRow}
        <span className="message-content">
          <PathHighlighter
            sessionDir={sessionDir}
            resolvedPaths={resolvedPaths}
            editorTemplate={editorTemplate}>
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
      {noteRow}
      <div className="message-content message-content-with-commands">
        {segments.map((segment, i) => {
          if (segment.type === 'text') {
            return (
              <span key={i}>
                <PathHighlighter
                  sessionDir={sessionDir}
                  resolvedPaths={resolvedPaths}
                  editorTemplate={editorTemplate}>
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
