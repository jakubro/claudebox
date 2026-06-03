/** Persisted output display with expandable full content. */

import { Download, Loader2, Maximize2, Minimize2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { getToolOutput, getToolOutputDownloadUrl } from '../../../../../../../../../api/sessions'
import CopyButton from '../../../../../../../../../components/CopyButton.jsx'
import { useSessionData } from '../../../../../../../../../context/SessionDataContext'
import { formatFileSize } from '../../../../../../../../../utils/formatters'

/**
 * Render persisted output with optional expand/collapse to fetch full content.
 * @param {Object} props
 * @param {string} props.preview - Preview text to display initially.
 * @param {string} props.toolUseId - Tool use ID for fetching full content.
 * @param {string} [props.fileSize] - Human-readable total file size.
 * @param {string} [props.previewSize] - Human-readable preview size.
 */
export default function PersistedOutputContent({ preview, toolUseId, fileSize, previewSize }) {
  const { sessionId } = useSessionData()
  const [showFull, setShowFull] = useState(false)
  const [fullContent, setFullContent] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleToggle = useCallback(async () => {
    if (showFull) {
      // Collapse - just toggle state
      setShowFull(false)
      return
    }

    // Expand - fetch if not already loaded
    if (!(fullContent || loading)) {
      setLoading(true)
      setError(null)
      try {
        const result = await getToolOutput(toolUseId)
        setFullContent(result)
      } catch (err) {
        setError(err.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    }
    setShowFull(true)
  }, [showFull, fullContent, loading, toolUseId])

  const displayContent = showFull && fullContent ? fullContent.content : preview

  return (
    <div className="persisted-output">
      {error && <div className="persisted-output-error">{error}</div>}

      {displayContent && (
        <div className="tool-details-wrapper">
          {toolUseId && sessionId && (
            <>
              <button
                type="button"
                className="copy-btn tool-expand-btn"
                onClick={handleToggle}
                title={showFull ? 'Show preview' : 'Show full output'}>
                {loading ? (
                  <Loader2 size={12} className="spinner" />
                ) : showFull ? (
                  <Minimize2 size={12} />
                ) : (
                  <Maximize2 size={12} />
                )}
              </button>
              <a
                href={getToolOutputDownloadUrl(toolUseId)}
                download
                className="copy-btn tool-download-btn"
                title="Download full output">
                <Download size={12} />
              </a>
            </>
          )}
          <CopyButton
            text={displayContent}
            className="tool-copy-btn"
            title={showFull ? 'Copy full output' : 'Copy preview'}
            size={12}
          />
          <pre className="tool-details">{displayContent}</pre>
          {showFull && fullContent?.truncated ? (
            <div className="persisted-output-truncated">
              Truncated to 100KB of {formatFileSize(fullContent.total_size)}
            </div>
          ) : (
            !showFull &&
            fileSize && (
              <div className="persisted-output-truncated">
                {previewSize
                  ? `Truncated to ${previewSize} of ${fileSize}`
                  : `Full output: ${fileSize}`}
              </div>
            )
          )}
        </div>
      )}
    </div>
  )
}
