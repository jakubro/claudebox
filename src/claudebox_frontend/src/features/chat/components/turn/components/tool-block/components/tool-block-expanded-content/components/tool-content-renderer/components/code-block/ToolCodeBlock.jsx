/** Parse raw tool output and render via CodeBlock with path toggle. */

import { useMemo, useState } from 'react'
import { getToolConfig } from '../../../../../../../../../../../../config/toolRegistry'
import { useSessionDir } from '../../../../../../../../../../../../context/SessionDataContext'
import usePathResolution from '../../../../../../../../../../../../hooks/usePathResolution'
import {
  extractPathCandidates,
  uniqueCandidates,
} from '../../../../../../../../../../../../utils/pathCandidates'
import CodeBlock from './CodeBlock'
import { parseEditLines, parseGrepLines, parseReadWriteLines } from './utils/outputLineParsers'

/** Code parser lookup — maps registry codeParser keys to parse functions. */
const CODE_PARSERS = {
  readWrite: details => ({ lines: parseReadWriteLines(details), hasClickableFiles: false }),
  grep: (details, outputMode, showFullPaths) => {
    const result = parseGrepLines(details, outputMode, showFullPaths)
    return { lines: result.lines, hasClickableFiles: result.isMultiFile && !result.isFilesOnly }
  },
  edit: (details, _outputMode, _showFullPaths, lineOffset) => ({
    lines: parseEditLines(details, lineOffset || 1),
    hasClickableFiles: false,
  }),
}

/**
 * @param {object} props
 * @param {string} props.toolName - Tool name (Read, Write, Grep, Edit).
 * @param {string} props.details - Raw output string from the tool.
 * @param {string} [props.outputMode] - Output mode for Grep tool parsing.
 * @param {number} [props.lineOffset] - Starting line number for Edit tool diffs.
 */
export default function ToolCodeBlock({ toolName, details, outputMode = null, lineOffset = null }) {
  const sessionDir = useSessionDir()
  const [showFullPaths, setShowFullPaths] = useState(false)

  const candidates = useMemo(
    () => (details ? uniqueCandidates(extractPathCandidates(details)) : []),
    [details],
  )
  const resolvedPaths = usePathResolution(candidates)

  const { lines, hasClickableFiles } = useMemo(() => {
    if (!details) {
      return { lines: [], hasClickableFiles: false }
    }

    const config = getToolConfig(toolName)
    const parser = config.codeParser ? CODE_PARSERS[config.codeParser] : null

    if (parser) {
      return parser(details, outputMode, showFullPaths, lineOffset)
    }

    // Unknown tool — render as plain lines
    return {
      lines: details.split('\n').map(line => ({ type: 'normal', content: line })),
      hasClickableFiles: false,
    }
  }, [toolName, details, outputMode, showFullPaths, lineOffset])

  const handleClick = hasClickableFiles
    ? e => {
        if (e.target.closest('.code-block-file')) {
          setShowFullPaths(prev => !prev)
        }
      }
    : undefined

  if (!details) {
    return null
  }

  return (
    <div onClick={handleClick} style={{ containerType: 'inline-size' }}>
      <CodeBlock
        lines={lines}
        fileColMaxWidth={showFullPaths ? '40cqi' : '20ch'}
        sessionDir={sessionDir}
        resolvedPaths={resolvedPaths}
      />
    </div>
  )
}
