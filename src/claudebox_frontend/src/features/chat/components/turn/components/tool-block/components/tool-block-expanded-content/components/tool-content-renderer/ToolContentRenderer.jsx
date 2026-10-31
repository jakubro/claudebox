/** Render tool output with appropriate formatting based on tool type. */

import CopyButton from '../../../../../../../../../../components/CopyButton.jsx'
import Markdown from '../../../../../../../../../../components/Markdown'
import { ToolName } from '../../../../../../../../../../config/schema'
import { getToolConfig } from '../../../../../../../../../../config/toolRegistry'
import { useSessionWorkspace } from '../../../../../../../../../../context/SessionDataContext'
import {
  getLanguageFromPath,
  looksLikeMarkdown,
} from '../../../../../../../../../../utils/languageDetection'
import MarkdownPreview from '../../../../../../../MarkdownPreview'
import { SyntaxHighlightedCodeBlock, ToolCodeBlock } from './components/code-block'
import DefaultCodeBlock from './components/DefaultCodeBlock'
import {
  extractCodeFromReadOutput,
  extractStartingLineNumber,
  getCopyableText,
} from './utils/copyableText'

// Markdown printed by a command run in the working directory; other tools' output names no place.
const OUTPUT_IN_WORKSPACE = new Set([ToolName.BASH, ToolName.TASK_OUTPUT])

/**
 * @param {string} props.toolName - Tool name (Edit, Read, Write, Grep, etc.).
 * @param {string} [props.filePath] - File path for syntax highlighting.
 * @param {string} [props.outputMode] - Grep output mode (files_with_matches, etc.).
 * @param {number} [props.lineOffset] - Starting line number for Edit tool diffs.
 * @param {string|null} [props.sourceUrl] - The page a WebFetch fetched.
 */
export default function ToolContentRenderer({
  toolName,
  details,
  filePath,
  outputMode = null,
  lineOffset = null,
  sourceUrl = null,
}) {
  const workspaceDir = useSessionWorkspace()

  if (!details) {
    return null
  }

  const config = getToolConfig(toolName)
  const copyableText = getCopyableText(toolName, details)

  // Syntax-aware tools: try syntax highlighting first, fall back to code block
  if (config.renderer === 'syntax-or-code' && filePath) {
    const language = getLanguageFromPath(filePath)
    if (language === 'markdown') {
      const code = extractCodeFromReadOutput(details)
      const startingLineNumber = extractStartingLineNumber(details)
      return (
        <div className="tool-details-wrapper">
          <MarkdownPreview
            content={code}
            startingLineNumber={startingLineNumber}
            filePath={filePath}
          />
        </div>
      )
    }
    if (language) {
      const code = extractCodeFromReadOutput(details)
      const startingLineNumber = extractStartingLineNumber(details)
      return (
        <div className="tool-details-wrapper">
          <CopyButton text={code} className="tool-copy-btn" title="Copy output" size={12} />
          <div className="tool-details">
            <SyntaxHighlightedCodeBlock
              code={code}
              language={language}
              startingLineNumber={startingLineNumber}
            />
          </div>
        </div>
      )
    }
  }

  // Code-parsed tools: use unified ToolCodeBlock
  if (config.renderer === 'syntax-or-code' || config.renderer === 'code') {
    return (
      <div className="tool-details-wrapper">
        <CopyButton text={copyableText} className="tool-copy-btn" title="Copy output" size={12} />
        <div className="tool-details">
          <ToolCodeBlock
            toolName={toolName}
            details={details}
            outputMode={outputMode}
            lineOffset={lineOffset}
          />
        </div>
      </div>
    )
  }

  // Markdown-rendered tools
  if (config.renderer === 'markdown') {
    return (
      <div className="tool-details-wrapper">
        <CopyButton text={copyableText} className="tool-copy-btn" title="Copy output" size={12} />
        <div className="tool-markdown-content turn-text">
          <Markdown baseUrl={sourceUrl}>{details}</Markdown>
        </div>
      </div>
    )
  }

  // Default: check for markdown content, otherwise CodeBlock with auto language detection
  if (looksLikeMarkdown(details)) {
    return (
      <div className="tool-details-wrapper">
        <MarkdownPreview
          content={details}
          baseDir={OUTPUT_IN_WORKSPACE.has(toolName) ? workspaceDir : null}
        />
      </div>
    )
  }

  return (
    <div className="tool-details-wrapper">
      <CopyButton text={copyableText} className="tool-copy-btn" title="Copy output" size={12} />
      <div className="tool-details">
        <DefaultCodeBlock content={details} />
      </div>
    </div>
  )
}
