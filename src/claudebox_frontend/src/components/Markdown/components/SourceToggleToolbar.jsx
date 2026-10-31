/** Top-right controls of a drawn block: switch between the drawing and its source, copy the source. */

import { Code } from 'lucide-react'
import CopyButton from '../../CopyButton.jsx'

/**
 * @param {string} props.source - The block's raw text, copied as is
 * @param {boolean} props.showSource - Whether the source is showing
 * @param {function} props.onToggle - Switches between drawing and source
 * @param {string} props.drawnTitle - Toggle title while the source shows, e.g. "Show map"
 */
export default function SourceToggleToolbar({ source, showSource, onToggle, drawnTitle }) {
  return (
    <div className="drawn-block-toolbar preview-toolbar">
      <button
        type="button"
        className={`preview-toolbar-btn${showSource ? ' pressed' : ''}`}
        onClick={onToggle}
        title={showSource ? drawnTitle : 'Show source'}>
        <Code size={14} />
      </button>
      <CopyButton text={source} size={12} title="Copy source" />
    </div>
  )
}
