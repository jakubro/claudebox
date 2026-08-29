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
  HOOK_RESPONSE: 'hook_response',
  INIT: 'init',
  COMPACT_START: 'compact_start',
  COMPACT_BOUNDARY: 'compact_boundary',
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
})

/** Falls back to the input unchanged when no alias applies. */
export function normalizeToolName(name) {
  return TOOL_NAME_ALIASES[name] ?? name
}

// --- Block types (produced by processEvents, consumed by TurnBlockList) ---
export const BlockType = Object.freeze({
  TEXT: 'text',
  THINKING: 'thinking',
  TOOL: 'tool',
  COMPACTION: 'compaction',
})

// --- Task status ---
export const TaskStatus = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
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
})
