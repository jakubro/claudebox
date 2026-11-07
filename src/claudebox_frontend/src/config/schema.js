/** Claude Code event protocol vocabulary - single source of truth for all event schema constants. */

// --- Event types (event.type) ---
export const EventType = Object.freeze({
  ASSISTANT: 'assistant',
  USER: 'user',
  SYSTEM: 'system',
  RESULT: 'result',
})

// --- Event subtypes (event.subtype) ---
export const EventSubtype = Object.freeze({
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL_USE: 'tool_use',
  TOOL_RESULT: 'tool_result',
  REPLAY_STARTED: 'replay_started',
  REPLAY_ENDED: 'replay_ended',
  INTERRUPT_SENT: 'interrupt_sent',
  MODEL_CHANGED: 'model_changed',
  PERMISSION_MODE_CHANGED: 'permission_mode_changed',
  EFFORT_LEVEL_CHANGED: 'effort_level_changed',
  CONTAINER_RESTARTED: 'container_restarted',
  TASK_NOTIFICATION: 'task_notification',
  SIBLING_MESSAGE: 'sibling_message',
  HOOK_RESPONSE: 'hook_response',
  INIT: 'init',
  COMPACT_START: 'compact_start',
  COMPACT_BOUNDARY: 'compact_boundary',
  ERROR: 'error',
})

// --- Tool names (event.content for tool_use events) ---
export const ToolName = Object.freeze({
  READ: 'Read',
  WRITE: 'Write',
  EDIT: 'Edit',
  GLOB: 'Glob',
  GREP: 'Grep',
  BASH: 'Bash',
  TASK: 'Task',
  SKILL: 'Skill',
  ASK_USER_QUESTION: 'AskUserQuestion',
  EXIT_PLAN_MODE: 'ExitPlanMode',
  TODO_WRITE: 'TodoWrite',
  TASK_CREATE: 'TaskCreate',
  TASK_UPDATE: 'TaskUpdate',
  CRON_CREATE: 'CronCreate',
  CRON_DELETE: 'CronDelete',
  TASK_LIST: 'TaskList',
  TASK_GET: 'TaskGet',
  TASK_OUTPUT: 'TaskOutput',
  WEB_SEARCH: 'WebSearch',
  WEB_FETCH: 'WebFetch',
  MCP_SEARCH: 'MCPSearch',
  TOOL_SEARCH: 'ToolSearch',
  // Claude reaches these through claudebox's own in-process MCP server, so its wire name
  // carries the SDK's mcp__{server}__{tool} convention; LangGraph's plain names alias to it below.
  SESSION_SPAWN: 'mcp__claudebox__session_spawn',
  SESSION_ASK: 'mcp__claudebox__session_ask',
  SESSION_READ: 'mcp__claudebox__session_read',
  SESSION_STOP: 'mcp__claudebox__session_stop',
  SESSION_LIST: 'mcp__claudebox__session_list',
  NEEDS_USER: 'mcp__claudebox__needs_user',
  PORT_OPEN: 'mcp__claudebox__port_open',
  PORT_CLOSE: 'mcp__claudebox__port_close',
  LIST_MCP_RESOURCES: 'ListMcpResourcesTool',
  READ_MCP_RESOURCE: 'ReadMcpResourceTool',
  READ_MCP_RESOURCE_DIR: 'ReadMcpResourceDirTool',
})

// --- LangGraph tool-name aliases ---
// LangGraph emits snake_case names; normalizeToolName maps them to Claude's PascalCase before any lookup/gate.
export const TOOL_NAME_ALIASES = Object.freeze({
  read_file: ToolName.READ,
  write_file: ToolName.WRITE,
  edit_file: ToolName.EDIT,
  glob: ToolName.GLOB,
  grep: ToolName.GREP,
  bash: ToolName.BASH,
  task: ToolName.TASK,
  skill: ToolName.SKILL,
  ask_user_question: ToolName.ASK_USER_QUESTION,
  web_search: ToolName.WEB_SEARCH,
  web_fetch: ToolName.WEB_FETCH,
  task_create: ToolName.TASK_CREATE,
  task_update: ToolName.TASK_UPDATE,
  task_get: ToolName.TASK_GET,
  task_list: ToolName.TASK_LIST,
  task_output: ToolName.TASK_OUTPUT,
  tool_search: ToolName.TOOL_SEARCH,
  session_spawn: ToolName.SESSION_SPAWN,
  session_ask: ToolName.SESSION_ASK,
  session_read: ToolName.SESSION_READ,
  session_stop: ToolName.SESSION_STOP,
  session_list: ToolName.SESSION_LIST,
  needs_user: ToolName.NEEDS_USER,
  port_open: ToolName.PORT_OPEN,
  port_close: ToolName.PORT_CLOSE,
  list_mcp_resources: ToolName.LIST_MCP_RESOURCES,
  read_mcp_resource: ToolName.READ_MCP_RESOURCE,
})

/** Falls back to the input unchanged when no alias applies. */
export function normalizeToolName(name) {
  return TOOL_NAME_ALIASES[name] ?? name
}

export const LANGGRAPH_RUNTIME_NAME = 'LangGraph'

// LangGraph names a connected server's tool by the tool's own name; these are the runtime's own.
const LANGGRAPH_OWN_TOOLS = new Set([
  ...Object.keys(TOOL_NAME_ALIASES),
  'notebook_edit',
  'task_stop',
])

/**
 * The connected tool server's tool a call names, or null for an agent's own tool. A name without
 * the `mcp__<server>__` form is a server's tool only in a LangGraph session, and names no server.
 * @returns {{server: string|null, tool: string}|null}
 */
export function mcpToolOf(name, runtimeName = null) {
  if (typeof name !== 'string' || !name) {
    return null
  }
  const normalized = normalizeToolName(name)
  if (normalized.startsWith(SdkProtocol.MCP_TOOL_PREFIX)) {
    return splitMcpName(normalized)
  }
  return runtimeName === LANGGRAPH_RUNTIME_NAME && !LANGGRAPH_OWN_TOOLS.has(name)
    ? { server: null, tool: name }
    : null
}

/** Whether a call's tool is marked: same name, or same tool where either side names no server. */
export function isHiddenTool(name, runtimeName, hiddenTools) {
  if (!hiddenTools?.size) {
    return false
  }
  const call = mcpToolOf(name, runtimeName)
  if (!call) {
    return false
  }
  if (hiddenTools.has(normalizeToolName(name))) {
    return true
  }
  for (const mark of hiddenTools) {
    const marked = mark.startsWith(SdkProtocol.MCP_TOOL_PREFIX)
      ? splitMcpName(mark)
      : { server: null, tool: mark }
    if (marked?.tool === call.tool && (marked.server === null || call.server === null)) {
      return true
    }
  }
  return false
}

// --- Block types (produced by processEvents, consumed by TurnBlockList) ---
export const BlockType = Object.freeze({
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL: 'tool',
  COMPACTION: 'compaction',
  SIBLING_MESSAGE: 'sibling-message',
})

// --- Task status ---
export const TaskStatus = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
})

// --- Task kind (Tasks panel row source) ---
export const TaskKind = Object.freeze({
  SUBAGENT: 'subagent',
  COMMAND: 'command',
})

// --- Todo status ---
export const TodoStatus = Object.freeze({
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
})

// --- Interrupt status ---
export const InterruptStatus = Object.freeze({
  STOPPING: 'stopping',
  STOPPED: 'stopped',
})

// --- Connection status ---
export const ConnectionStatus = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  ERROR: 'error',
})

// --- Queue item status ---
export const QueueStatus = Object.freeze({
  QUEUED: 'queued',
  PAUSED: 'paused',
})

// --- Task notification status ---
export const NotificationStatus = Object.freeze({
  FAILED: 'failed',
  KILLED: 'killed',
  COMPLETED: 'completed',
})

// --- TaskOutput retrieval status ---
export const TaskOutputStatus = Object.freeze({
  TIMEOUT: 'timeout',
  FAILED: 'failed',
  KILLED: 'killed',
  NOT_READY: 'not_ready',
  RUNNING: 'running',
  ASYNC_LAUNCHED: 'async_launched',
})

// --- Permission mode IDs ---
export const PermissionMode = Object.freeze({
  BYPASS: 'bypassPermissions',
  PLAN: 'plan',
  ACCEPT_EDITS: 'acceptEdits',
  DONT_ASK: 'dontAsk',
  AUTO: 'auto',
})

// --- SDK protocol strings (fragile coupling to SDK output format) ---
export const SdkProtocol = Object.freeze({
  PLACEHOLDER_CONTENT: '(no content)',
  AWAITING_ANSWER_TEXT: 'Answer questions?',
  PAGINATION_PATTERN: /\n*\[Showing results with pagination = [^\]]*\]$/,
  INTERRUPT_ACK_PATTERN: /^\[.*interrupt.*\]$/i,
  AGENT_ID_PREFIX: 'agentId:',
  MODEL_SET_PATTERN: /^<local-command-stdout>Set model to .+<\/local-command-stdout>$/,
  EFFORT_SET_PATTERN: /^<local-command-stdout>Set effort to .+<\/local-command-stdout>$/,
  STOP_HOOK_FEEDBACK_PATTERN: /^Stop hook feedback:\n?/,
  NO_VISIBLE_OUTPUT_PATTERN: /^\[Your previous response had no visible output\.[^\]]*\]$/,
  SKILL_REINVOCATION_PATTERN: /^\(Re-invocation of \/\S+[\s\S]*\)$/,
  MCP_TOOL_PREFIX: 'mcp__',
})

function splitMcpName(name) {
  const rest = name.slice(SdkProtocol.MCP_TOOL_PREFIX.length)
  const cut = rest.indexOf('__')
  return cut > 0 ? { server: rest.slice(0, cut), tool: rest.slice(cut + 2) } : null
}
