/** Reusable copy-to-clipboard button with visual feedback. */

import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { COPY_BUTTON_FEEDBACK_MS } from '../config/timing'

/**
 * Render a button that copies text to clipboard with visual confirmation.
 * @param {Object} props
 * @param {string} props.text - Text to copy to clipboard.
 * @param {string} [props.className] - Additional CSS classes.
 * @param {number} [props.size] - Icon size in pixels.
 * @param {string} [props.title] - Button tooltip text.
 * @param {React.ComponentType} [props.icon] - Custom icon component.
 */
export default function CopyButton({ text, className = '', size = 14, title, icon: Icon = Copy }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), COPY_BUTTON_FEEDBACK_MS)
    } catch (_err) {
      // Clipboard access denied
    }
  }

  return (
    <button
      type="button"
      className={`copy-btn ${className}`}
      onClick={handleCopy}
      title={title || (copied ? 'Copied!' : 'Copy')}>
      {copied ? <Check size={size} /> : <Icon size={size} />}
    </button>
  )
}
