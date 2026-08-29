/** Renders an MCP tool result's own content blocks by type, in order. */

import JsonView from '@uiw/react-json-view'
import { darkTheme } from '@uiw/react-json-view/dark'
import { looksLikeJson } from '../../../../../../../../../utils/languageDetection'
import ToolContentRenderer from './tool-content-renderer'

/**
 * @param {string} props.toolName - Forwarded to a text block's render path, so it draws exactly
 *   as a plain tool result would.
 * @param {Array} props.blocks - The result's own content blocks, already in the order it defines.
 */
export default function McpContentBlocks({ toolName, blocks }) {
  return (
    <div className="mcp-content-blocks">
      {blocks.map((block, i) => (
        <McpContentBlock key={i} toolName={toolName} block={block} />
      ))}
    </div>
  )
}

function McpContentBlock({ toolName, block }) {
  switch (block?.type) {
    case 'text':
      return <McpTextBlock toolName={toolName} text={block.text ?? ''} />
    case 'image':
      return <McpImageBlock data={block.data} mimeType={block.mimeType} />
    case 'audio':
      return <McpUnviewableBlock label="Audio" mimeType={block.mimeType} />
    case 'resource_link':
      return <McpResourceLink name={block.name} description={block.description} uri={block.uri} />
    case 'resource':
      return <McpEmbeddedResource toolName={toolName} resource={block.resource} />
    default:
      // A block type this app has never heard of still shows something rather than disappearing.
      return <McpUnknownBlock block={block} />
  }
}

/**
 * A text block whose content is itself JSON keeps the tree - the MCP spec has structured-content
 * tools serialize JSON into a text block. Decided per block, so prose and JSON can coexist.
 * @param {string} props.toolName - Forwarded to the shared text-rendering path.
 * @param {string} props.text - The block's own text content.
 */
function McpTextBlock({ toolName, text }) {
  const trimmed = text.trim()
  if (looksLikeJson(trimmed)) {
    try {
      return <McpJsonBlock value={JSON.parse(trimmed)} />
    } catch (_e) {
      // Not JSON - render as text below.
    }
  }
  return <ToolContentRenderer toolName={toolName} details={text} />
}

function McpImageBlock({ data, mimeType }) {
  if (!data) {
    return null
  }
  return (
    <div className="mcp-image-block">
      <img src={`data:${mimeType || 'application/octet-stream'};base64,${data}`} alt="" />
    </div>
  )
}

function McpResourceLink({ name, description, uri }) {
  return (
    <div className="mcp-resource-link">
      <a href={uri} target="_blank" rel="noopener noreferrer">
        {name || uri}
      </a>
      {description && <div className="mcp-resource-description">{description}</div>}
    </div>
  )
}

/**
 * An embedded resource is text (rendered exactly as a text block) or binary (no viewer).
 * @param {string} props.toolName - Forwarded to the text path when the resource embeds text.
 * @param {object} props.resource - The block's own embedded resource payload.
 */
function McpEmbeddedResource({ toolName, resource }) {
  if (resource?.text != null) {
    return <McpTextBlock toolName={toolName} text={resource.text} />
  }
  return <McpUnviewableBlock label="Resource" mimeType={resource?.mimeType} uri={resource?.uri} />
}

/**
 * The app has no viewer for this block's own payload (audio, binary resource) - name it instead.
 * @param {string} props.label - What kind of unviewable content this is (e.g. "Audio").
 * @param {string} [props.mimeType] - The payload's own media type, shown when known.
 * @param {string} [props.uri] - The payload's own location, shown when known.
 */
function McpUnviewableBlock({ label, mimeType, uri }) {
  return (
    <div className="mcp-unviewable-block">
      {label}
      {mimeType ? ` (${mimeType})` : ''}
      {uri ? ` - ${uri}` : ''}
    </div>
  )
}

function McpUnknownBlock({ block }) {
  return <McpJsonBlock value={block} />
}

/**
 * Shared JSON-tree presentation for a block whose content is JSON, known or not.
 * @param {*} props.value - The already-parsed value to render as a tree.
 */
function McpJsonBlock({ value }) {
  return (
    <div className="tool-json">
      <JsonView
        value={value}
        style={darkTheme}
        collapsed={false}
        displayDataTypes={false}
        displayObjectSize={false}
      />
    </div>
  )
}
