/** Highlighted source of a block that could not be drawn, under a notice naming the reason. */

import SyntaxHighlighter from 'react-syntax-highlighter'
import { vs2015 } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import CopyButton from '../../CopyButton.jsx'

/**
 * @param {string} props.source - The block's raw text
 * @param {string} props.language - Highlighting language for the source
 * @param {string} props.prefix - What failed, e.g. "Map failed to draw"
 * @param {string} [props.reason] - Why, appended after the prefix when present
 * @param {boolean} props.noticeVisible - False while the block may still be streaming in
 */
export default function SourceFallback({ source, language, prefix, reason, noticeVisible }) {
  return (
    <div className="code-block-wrapper">
      <CopyButton text={source} className="code-copy-btn" title="Copy code" size={12} />
      {noticeVisible && (
        <div className="render-failure-notice">
          <span className="render-failure-icon" aria-hidden="true">
            !
          </span>
          <span className="render-failure-text">
            {prefix}
            {reason ? ` - ${reason}` : ''}
          </span>
        </div>
      )}
      <SyntaxHighlighter style={vs2015} language={language} PreTag="div">
        {source}
      </SyntaxHighlighter>
    </div>
  )
}
