/** UI layout constants - dimensions, sizes, visual thresholds. */

export const DEFAULT_PANEL_WIDTH = 0.15
export const MINIMAP_MIN_WIDTH = 8
export const MINIMAP_MAX_WIDTH = 20
export const AUTOSCROLL_THRESHOLD = 50
export const MINIMAP_AUTO_HIDE_DELAY = 750
export const MINIMAP_MOUSE_LEAVE_DELAY = 500
export const MINIMAP_MIN_THUMB_HEIGHT = 16
export const MINIMAP_PROXIMITY_THRESHOLD = 50
export const FLOATING_PANEL_WIDTH = 300
/**
 * Fixed chrome of a turn, before its content is priced - see predictTurnHeight. Two constants
 * because a fully routed-away turn pays the user-message chrome but renders no assistant bubble.
 */
export const TURN_USER_MESSAGE_HEIGHT_PX = 16
export const TURN_ASSISTANT_BUBBLE_HEIGHT_PX = 64
/** Combined horizontal inset: .chat-messages padding + .turn bubble padding. */
export const TURN_HORIZONTAL_PADDING_PX = 56
export const AVG_CHAR_WIDTH_PX = 8
export const LINE_HEIGHT_PX = 18
export const PX_PER_THINKING_BLOCK = 60
export const PX_PER_TOOL_BLOCK = 40
/** Bash's own Command + Result sections add chrome beyond a plain tool block. */
export const PX_PER_BASH_TOOL_BLOCK = 200
export const PX_PER_ATTACHMENT_ROW = 42
/** Assumed item pitch (width + gap) for fitting attachments into a row at a given column width -
 * the row sits inside the message surface's padding, so it needs the same width-aware treatment. */
export const ASSUMED_ATTACHMENT_WIDTH_PX = 190
export const ATTACHMENT_GAP_PX = 8
/** Flat height of the collapsed "Replied inline" placeholder (independent of comment count). */
export const PX_PER_INLINE_REPLIES_PLACEHOLDER = 30
export const TURN_MIN_PREDICTED_HEIGHT_PX = 100
/** A promoted thread's folded-history row - fixed height, whatever run it stands in for. */
export const THREAD_FOLD_ROW_HEIGHT_PX = 32
// Turns mounted beyond the viewport per side - avoids scroll gaps, bounds the mounted set on large sessions.
export const TURN_OVERSCAN = 4
export const FLOATING_PANEL_MIN_HEIGHT = 300
export const WIDE_FLOAT_MIN_HEIGHT_RATIO = 0.3
export const WIDE_FLOAT_MIN_WIDTH_RATIO = 0.6
export const WIDE_FLOAT_MIN_WIDTH = 800
export const LOGS_STRIP_DEFAULT_HEIGHT = 240
export const LOGS_STRIP_MIN_HEIGHT = 80
export const LOGS_STRIP_MAX_HEIGHT_RATIO = 0.6
export const MOBILE_BREAKPOINT = 768
/** Chat content area's transcript/terminal split - divider ratio and each side's floor width. */
export const CHAT_SPLIT_DEFAULT_RATIO = 0.5
export const CHAT_TRANSCRIPT_MIN_WIDTH = 320
export const CHAT_TERMINAL_MIN_WIDTH = 320
export const CHAT_SPLIT_DIVIDER_WIDTH = 5
/** Terminal column height prediction - line count only, no wrap. */
export const TERMINAL_LINE_HEIGHT_PX = 17
/** .terminal-entry chrome: margin-bottom only; the buttons overlay the first line. */
export const TERMINAL_ENTRY_BASE_HEIGHT_PX = 16
export const TERMINAL_ENTRY_MIN_PREDICTED_HEIGHT_PX = 60
export const TERMINAL_OVERSCAN = 4
/** Work panel's own minimum width, declared alongside the terminal's rather than reusing it. */
export const CHAT_WORK_MIN_WIDTH = 320
/** Session rail: each ancestor's fixed column width, and the focused group's read-only floor. */
export const CHAT_RAIL_ANCESTOR_WIDTH = 360
/** Beyond this many rendered groups, the middle collapses into the header path. */
export const CHAT_RAIL_MAX_DEPTH = 4
/** .work-turn-separator chrome: the "~~ turn N ~~" label row above each entry's blocks. */
export const WORK_ENTRY_SEPARATOR_HEIGHT_PX = 32
export const WORK_ENTRY_MIN_PREDICTED_HEIGHT_PX = 60
export const WORK_OVERSCAN = 4
/** .work-column's horizontal inset - tool-block headers wrap inside this, unlike the terminal. */
export const WORK_ENTRY_HORIZONTAL_PADDING_PX = 32
/** Mermaid zoom overlay's scale bounds, relative to the fitted (opening) scale. */
export const MERMAID_ZOOM_MIN_SCALE_RATIO = 0.25
export const MERMAID_ZOOM_MAX_SCALE_RATIO = 8
