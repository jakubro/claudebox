/** Storage keys - localStorage and API state paths. */

export const PINNED_PATH = 'pinnedSessions'
export const BOOKMARKED_TURNS_PATH = 'bookmarkedTurns'
export const BOOKMARK_META_PATH = 'bookmarkMeta'
export const WORKSPACE_COLOR_PATH = 'workspaceColor'
export const FOCUSED_HIDDEN_TOOLS_PATH = 'focusedHiddenTools'
export const SESSIONS_PANEL_FILTER_PATH = 'sessionsPanelFilter'
export const WORKSPACE_STORAGE_KEY = 'claudebox-workspace-id'
// Nothing writes this key; useRateLimitStatus removes it on mount.
export const RATE_LIMITS_STORAGE_KEY = 'claudebox-rate-limits'

// Per-session prefixes, GC'd by utils/sessionStorageGc.js once the session ends; keys below stay global.
export const MESSAGE_QUEUE_STORAGE_PREFIX = 'queue:'
export const DRAFT_STORAGE_PREFIX = 'draft:'
export const INPUT_HISTORY_STORAGE_PREFIX = 'inputHistory:'
export const INLINE_REPLIES_STORAGE_PREFIX = 'inline-replies:'

// When the dead-session storage sweep last ran, shared by every tab so a reload does not repeat it.
export const SESSION_STORAGE_SWEEP_AT_KEY = 'claudebox-session-storage-swept-at'

// Cross-tab change-signal keys (storage event).
export const BOOKMARKS_CHANGE_SIGNAL_KEY = 'claudebox-bookmarks-changed'
export const PINS_CHANGE_SIGNAL_KEY = 'claudebox-pins-changed'
export const FOCUSED_HIDDEN_TOOLS_CHANGE_SIGNAL_KEY = 'claudebox-focused-hidden-tools-changed'
