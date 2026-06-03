# Claudebox Specification

> **Purpose**: This document describes user-facing behavior only—what the user sees and experiences. It is not concerned with implementation details, architecture, or code structure.

## Overview

Claudebox is a containerized development environment for Claude AI. The web UI provides:

- Real-time streaming chat
- Dockable panel layout with persistence
- Session management
- Interactive tool execution

---

## 1. Layout

### 1.1 Structure

```
┌─────────────────────────────────────────────────────────────┐
│ [Left Strip] │       Center Panels         │ [Right Strip]  │
│              │                             │                │
│  Sessions    │   ┌─────────────────────┐   │    Todos       │
│              │   │      Chat Tab       │   │    Stash       │
│              │   │                     │   │    Tasks       │
│              │   │                     │   │    Bookmarks   │
│              │   └─────────────────────┘   │    Boards      │
│              │                             │    Usage       │
│              │                             │    MCP         │
│              │                             │    Commands    │
│              │                             │    Help        │
├─────────────────────────────────────────────────────────────┤
│              Logs strip (when open, full width)             │
├─────────────────────────────────────────────────────────────┤
│                         Footer                              │
└─────────────────────────────────────────────────────────────┘
```

When the logs panel is open, it occupies the full screen width above the footer; closing it returns the space to the main row. <!-- claim:layout:logs-strip-full-width -->

When two bottom-slot panels are open at the same time, they split the bottom strip 50/50 horizontally (left slot on the left, right slot on the right); when only one is open it fills the whole strip; closing the last one returns the space to the main row. <!-- claim:layout:bottom-panel-split -->

### 1.2 Icon Strips

- **Left strip**: Sessions (top, only icon) <!-- claim:layout:left-strip -->
- **Right strip**: Todos, Stash, Tasks, Bookmarks, Boards, Usage, MCP, Commands, Help (top to bottom); Logs sits at the bottom of the right strip <!-- claim:layout:right-strip -->
- The Logs icon lives at the bottom of the right strip <!-- claim:layout:logs-right-bottom -->
- Icons show badge counts for Todos (incomplete) and Stash (item count) <!-- claim:layout:badges -->
- Clicking toggles panel visibility <!-- claim:layout:icon-toggle -->
- Tooltip shows panel name and shortcut <!-- claim:layout:icon-tooltip -->

### 1.3 Panel Behavior

| Behavior                   | Expected                              |
|----------------------------|---------------------------------------|
| Toggle panel on            | Opens at canonical position (see 1.4) | <!-- claim:layout:panel-toggle-on -->
| Toggle panel off           | Saves width, panel closes             | <!-- claim:layout:panel-toggle-off -->
| Reopen panel               | Restores saved width                  | <!-- claim:layout:panel-reopen-width -->
| Close all panels on side   | Chat expands to fill                  | <!-- claim:layout:panel-close-all -->
| Reopen after closing all   | Restores previous widths              | <!-- claim:layout:panel-reopen-after-all -->
| Drag panel to new position | Removes panel from side order          | <!-- claim:layout:panel-drag-invalidate -->

- Chat panel always visible (cannot be closed) <!-- claim:layout:panel-chat-permanent -->
- Skills, Tasks, and Containers panel rows share a padded-card look with a subtle background, brighter on hover, and consistent vertical spacing. Identifier values are monospaced; other text uses the regular font. <!-- claim:layout:panel-row-card -->
- Hovering an icon while panels are maximized opens that panel as a floating overlay anchored to the icon, after a short hover-intent delay. The overlay grows to fit its content and stays within the icon strip's vertical bounds <!-- claim:layout:floating-panel -->
- Logs and Containers floating previews open wider than other panels to fit their horizontally-dense rows <!-- claim:layout:floating-panel-wide-panels -->
- When no panels are maximized, hovering an icon for a panel that is not currently visible (a closed side panel, or the closed logs strip) opens its floating preview after a short hover-intent delay <!-- claim:layout:floating-panel-inactive -->

### 1.4 Canonical Panel Order

Panels maintain consistent vertical stacking within each side: <!-- claim:layout:panel-order-stack -->

- **Left**: Sessions <!-- claim:layout:panel-order-left -->
- **Right**: Todos (top), Stash, Tasks, Bookmarks, Boards, Usage, MCP, Commands, Help (bottom) <!-- claim:layout:panel-order-right -->

Opening a panel inserts it at correct position relative to visible panels. <!-- claim:layout:panel-order-insert -->

### 1.5 Layout Persistence

- Layout saved automatically on every change <!-- claim:layout:save -->
- Includes panel configuration and widths <!-- claim:layout:save-content -->
- Restored on page load; falls back to default if unavailable <!-- claim:layout:restore -->
- New sessions inherit panel layout from most recent session <!-- claim:layout:auto-copy -->

### 1.6 Default Layout

- Main panel in center, default content is the welcome view (chat content appears once a session is opened) <!-- claim:layout:default-chat-center -->
- Sessions panel opens on left <!-- claim:layout:default-left-panels -->
- Todos, Stash, Tasks, Bookmarks, Boards panels open on right; Usage and MCP remain hidden by default <!-- claim:layout:default-right-panels -->

### 1.7 Browser Tab Title

- Format: `[Session Name] | [Workspace] | Claudebox`; before session init, format is `[Workspace] | Claudebox` <!-- claim:notify:title-format -->
- Updates when session name changes <!-- claim:notify:title-update -->

### 1.8 Session URL

The browser URL hash reflects the active session and the user's current scroll position within it: <!-- claim:url:hash-reflects-state -->

| Hash form                                                | Meaning                                                       |
|----------------------------------------------------------|---------------------------------------------------------------|
| `#/workspaces/{id}`                                      | Welcome state, no active session                              | <!-- claim:url:workspace-only -->
| `#/workspaces/{id}/sessions/{sessionId}`                 | Active session; scrolled to the latest message, following new responses | <!-- claim:url:session-bottom -->
| `#/workspaces/{id}/sessions/{sessionId}/turns/u-{turnId}` | Active session; paused at user message in turn `{turnId}`     | <!-- claim:url:session-turn-user -->
| `#/workspaces/{id}/sessions/{sessionId}/turns/a-{turnId}` | Active session; paused at assistant message in turn `{turnId}` | <!-- claim:url:session-turn-assistant -->
| `#/workspaces/{id}/boards/{boardId}`                     | Active board                                                   | <!-- claim:url:board -->

- Hash auto-updates as the user scrolls: gains `/turns/<role>-<id>` segment when autoscroll disengages; loses the segment when the user scrolls back to bottom and autoscroll re-engages <!-- claim:url:scroll-sync -->
- Hash updates apply to all scroll causes — user scroll, programmatic jump (bookmark click, scroll-to-edge), autoscroll re-engage <!-- claim:url:scroll-sync-all-causes -->
- Hash updates do not add entries to browser back/forward history <!-- claim:url:scroll-sync-history-clean -->
- On reload, the URL form is honored: bare URL → scroll to bottom and autoscroll engaged; turn URL → scroll to that turn and autoscroll disengaged <!-- claim:url:reload-restore -->
- Bookmarks and other cross-session navigation produce URLs with the appropriate `/turns/<role>-<id>` segment so deep-links and Alt+click-to-new-browser-tab land on the targeted message <!-- claim:url:cross-session-deep-link -->

---

## 2. Keyboard Shortcuts

### 2.1 Panel Navigation

| Shortcut | Action          |
|----------|-----------------|
| Alt+C    | Focus Chat tab  | <!-- claim:shortcut:altc -->
| Alt+0    | Toggle Logs     | <!-- claim:shortcut:alt0 -->
| Alt+1    | Toggle Sessions  | <!-- claim:shortcut:alt1 -->
| Alt+2    | Toggle Todos     | <!-- claim:shortcut:alt2 -->
| Alt+3    | Toggle Stash     | <!-- claim:shortcut:alt3 -->
| Alt+4    | Toggle Tasks     | <!-- claim:shortcut:alt4 -->
| Alt+5    | Toggle Bookmarks | <!-- claim:shortcut:alt5 -->
| Alt+6    | Toggle Boards    | <!-- claim:shortcut:alt6 -->
| Alt+7    | Toggle Usage     | <!-- claim:shortcut:alt7 -->
| Alt+8    | Toggle MCP       | <!-- claim:shortcut:alt8 -->
| Alt+9    | Toggle Commands  | <!-- claim:shortcut:alt9 -->
| Alt+? (or Alt+/) | Help overlay (toggle) | <!-- claim:shortcut:alt-question -->
| Alt+N    | New session (current browser tab) | <!-- claim:shortcut:alt-n -->
| Alt+Shift+N | New session (new browser tab) | <!-- claim:shortcut:alt-shift-n -->

- Alt+? opens Help panel as centered modal overlay; Escape or clicking backdrop closes it <!-- claim:panel-help:overlay -->

### 2.2 Chat Input

| Shortcut     | Action                                                  |
|--------------|---------------------------------------------------------|
| Enter        | Send message                                            | <!-- claim:shortcut:enter -->
| Shift+Enter  | Insert newline with inherited indent; on markdown list lines, auto-continue the list marker (auto-incremented for numbered, always unchecked for tasks); empty marker exits the list | <!-- claim:shortcut:shift-enter -->
| Tab          | Indent — snap leading whitespace to next multiple of 2 (or insert 2 spaces at caret in content zone) | <!-- claim:shortcut:tab -->
| Shift+Tab    | Dedent — snap leading whitespace to previous multiple of 2; no-op if no leading whitespace | <!-- claim:shortcut:shift-tab -->
| Up Arrow     | Previous message in history (when cursor at position 0 with no selection); cursor placed at beginning | <!-- claim:shortcut:arrow-up -->
| Down Arrow   | Next message in history (when cursor at end); cursor placed at end     | <!-- claim:shortcut:arrow-down -->
| Ctrl+.       | Interrupt/stop response                                 | <!-- claim:shortcut:ctrl-dot -->
| Ctrl+S       | Stash current input (save)                              | <!-- claim:shortcut:ctrl-s -->
| Ctrl+Shift+S | Pop from stash (remove and insert)                      | <!-- claim:shortcut:ctrl-shift-s -->
| Ctrl+,       | Wrap selection in `<this></this>`                       | <!-- claim:shortcut:ctrl-comma -->
| Ctrl+'       | Collapse nearest XML block at cursor                    | <!-- claim:shortcut:ctrl-quote -->
| Ctrl+Shift+' | Collapse all XML blocks                                 | <!-- claim:shortcut:ctrl-shift-quote -->
| Ctrl+\       | Expand nearest collapsed block at cursor                | <!-- claim:shortcut:ctrl-backslash -->
| Ctrl+Shift+\ | Expand all collapsed blocks                             | <!-- claim:shortcut:ctrl-shift-backslash -->

- Ctrl+, with no selection inserts empty `<this></this>` at cursor <!-- claim:shortcut:ctrl-comma-empty -->
- Collapsed blocks display as `<tag...N>` placeholder in textarea text (N is a sequence number) <!-- claim:input:collapse-placeholder -->
- Collapse targets innermost enclosing block; repeated Ctrl+' collapses next outer <!-- claim:input:collapse-nested -->
- Collapsed blocks auto-expand before submit (full content sent to server) <!-- claim:input:collapse-auto-expand -->
- Chat input shortcuts require chat panel focus (except Alt navigation shortcuts, which are global) <!-- claim:shortcut:focus-required -->

### 2.3 Chat Navigation

| Shortcut | Action |
|----------|--------|
| Alt+Up   | Jump to previous human message | <!-- claim:shortcut:alt-up -->
| Alt+Down | Jump to next human message | <!-- claim:shortcut:alt-down -->
| Alt+Home | Jump to first message (top of chat) | <!-- claim:shortcut:alt-home -->
| Alt+End  | Jump to last message (bottom of chat) | <!-- claim:shortcut:alt-end -->

- Alt+Up/Down navigate relative to the visible area: previous means above the visible area, next means below <!-- claim:shortcut:jump-viewport -->
- Alt+Down past last message scrolls to bottom; Alt+Up past first message scrolls to top <!-- claim:shortcut:jump-boundary -->
- Jumped-to message scrolls to the top of the visible area and receives a brief highlight flash <!-- claim:shortcut:jump-highlight -->

### 2.4 Tab Interactions

| Shortcut         | Action                    |
|------------------|---------------------------|
| Double-click tab | Maximize panel (toggle)   | <!-- claim:layout:tab-double-click -->
| Middle-click tab | Close panel (except Chat) | <!-- claim:layout:tab-middle-click -->

- Session header strip "+" button: creates new session in current browser tab, focuses chat; Alt+Click or middle-click opens new session in new browser tab <!-- claim:layout:header-new-session -->
- "+" button has chevron dropdown with options: "New session", "New session in new browser tab" <!-- claim:layout:header-new-menu -->
- Where multiple side panels share a tab bar, that tab bar fades from a neutral dark on the left edge to the workspace accent color on the right edge <!-- claim:layout:tab-bar-gradient -->
- Header buttons in those tab bars tint toward a brightened workspace accent color on hover when a workspace color is set; tint clears when no workspace color is set <!-- claim:layout:tab-bar-hover-tint -->

### 2.5 Maximize Behavior

- Double-click saves full layout before maximizing <!-- claim:layout:maximize-save-layout -->
- Second double-click restores exact previous layout <!-- claim:layout:maximize-restore -->
- All panel sizes preserved after unmaximize <!-- claim:layout:maximize-preserve-sizes -->
- Toggling an already-open side panel while maximized just unmaximizes (panel stays visible) <!-- claim:layout:maximize-toggle-open -->
- Toggling a closed side panel while maximized unmaximizes and opens the panel <!-- claim:layout:maximize-toggle-closed -->
- Toggling the logs strip while maximized unmaximizes; if closed, also opens it <!-- claim:layout:maximize-toggle-logs -->

### 2.6 Session Header Strip

A horizontal strip at the top of the main panel that hosts session context (left) and global controls (right): <!-- claim:layout:session-header -->

| Slot  | Contents                                                                                                              |
|-------|-----------------------------------------------------------------------------------------------------------------------|
| LEFT  | Status dot (green=running, amber=stopping, gray=stopped/none); session name; Stop button (when container running)     | <!-- claim:layout:header-left-slot -->
| RIGHT | "+" new session button + chevron dropdown ("New session", "New session in new browser tab"); workspace switcher        | <!-- claim:layout:header-right-slot -->

When the main panel renders a board view, the LEFT slot replaces the session trio with a board icon and the board's name; clicking the name copies the board's filesystem path. <!-- claim:layout:header-board-view -->

- Each browser tab hosts exactly one session at a time; multiple sessions = multiple browser tabs <!-- claim:layout:single-session -->
- Clicking the session name focuses the chat textarea <!-- claim:layout:header-name-click -->
- Status dot color follows the container lifecycle: green (running), amber (stopping), gray (stopped or no container) <!-- claim:layout:header-status-dot -->
- The Stop button appears when the session has a running container; clicking while Claude is responding opens a confirmation modal, while idle stops the session silently <!-- claim:layout:header-stop -->
- Welcome state (no active session): the LEFT slot is empty; the RIGHT slot remains active <!-- claim:layout:header-welcome -->
- The header strip stays visible while a panel is maximized <!-- claim:layout:header-maximize -->
- The header strip has no right-click context menu — Stop is the only header-strip action; rename, pin/unpin, and "open in new browser tab" live in the SessionsPanel right-click menu <!-- claim:layout:header-no-context-menu -->
- Strip background fades from a neutral dark on the left edge to the workspace accent color on the right edge when a workspace accent is set; clears to a neutral dark when no accent is set <!-- claim:layout:header-accent-gradient -->
- Strip interactive elements (session-name button, Stop button, "+" new session split-button, workspace switcher trigger) tint toward a brightened workspace accent on hover when a workspace accent is set; tint clears to a neutral hover background when no accent is set <!-- claim:layout:header-accent-hover -->

### 2.7 Confirmation Policy and Replace-While-Responding Toast

Confirmations are reserved for **destructive** actions — those that terminate or interrupt in-progress work. Non-destructive actions execute silently. <!-- claim:layout:confirm-destructive-only -->

| Action                                                                            | While Claude is responding | While idle |
|-----------------------------------------------------------------------------------|----------------------------|------------|
| Stop session (header strip Stop button or SessionsPanel right-click)               | Confirmation modal         | Silent     | <!-- claim:layout:confirm-stop -->
| Fork-here (whole session, from chat control bar) — same container                  | Confirmation modal         | Silent     | <!-- claim:layout:confirm-fork-here -->
| Rewind-here (per-turn, from message rewind button) — same container                | Confirmation modal         | Silent     | <!-- claim:layout:confirm-rewind-here -->
| Fork-browser-tab / Rewind-browser-tab (new browser tab)                            | Silent                     | Silent     | <!-- claim:layout:no-confirm-fork-browser -->
| Resume session (SessionsPanel click or Bookmark click) in current browser tab      | Toast                      | Silent     | <!-- claim:layout:no-confirm-resume -->
| New session in current browser tab                                                  | Toast                      | Silent     | <!-- claim:layout:no-confirm-new-session -->
| Workspace switch (when previous session was responding)                             | Toast                      | Silent     | <!-- claim:layout:no-confirm-workspace-switch -->
| Browser tab close, page reload                                                       | Silent                     | Silent     | <!-- claim:layout:no-confirm-tab-close -->

Confirmation modal: <!-- claim:layout:confirm-modal -->

- Title: "Claude is working" <!-- claim:layout:confirm-modal-title -->
- Detail: states the action and its effect (e.g., "Stopping the session will end the response. Continue?") <!-- claim:layout:confirm-modal-detail -->
- Buttons: Cancel (returns without action) and Continue (proceeds with the destructive action) <!-- claim:layout:confirm-modal-actions -->

Replace-while-responding toast: when the user navigates the current browser tab to a different session while the previous session was responding — and the navigation does not interrupt the response (resume, bookmark click, new session, workspace switch) — a passive toast appears: <!-- claim:layout:toast-still-running -->

- Text: "Session [previous name] still running" <!-- claim:layout:toast-text -->
- Click action: returns to the previous session <!-- claim:layout:toast-click-return -->
- Auto-dismiss: 5 seconds <!-- claim:layout:toast-auto-dismiss -->
- Does not appear when: the action is destructive (covered by modal instead), the action opens a new browser tab, or the action is browser back/forward navigation <!-- claim:layout:toast-non-trigger -->

Switching sessions in the current browser tab is instant — the previous session continues running in the background. <!-- claim:layout:session-switch-immediate -->

Progress label reflects actual action: "Starting session" for new sessions, "Loading session" when returning to an already-running session. <!-- claim:layout:session-switch-progress-label -->

### 2.8 Main Panel

The center area of the workspace shows a single **main panel** whose content is selected by the active URL: <!-- claim:layout:main-panel-single-slot -->

| URL hash form                                                  | Main panel content        |
|----------------------------------------------------------------|---------------------------|
| `#/workspaces/{id}`                                            | Welcome content           |
| `#/workspaces/{id}/sessions/{sessionId}` (with optional `/turns/...`) | Chat for that session |
| `#/workspaces/{id}/boards/{boardId}`                           | That board                |

- The main panel shows exactly one of {welcome, chat, board} at a time <!-- claim:layout:main-panel-single-slot -->
- No tab bar appears on the main panel — the Session Header Strip (§2.6) is its sole chrome <!-- claim:layout:main-panel-no-tabs -->
- Opening a board (via Boards Panel click, bookmark, or deep-link) updates the URL to `#/workspaces/{id}/boards/{boardId}` and the main panel content swaps to that board <!-- claim:layout:main-panel-board-url -->
- A bare workspace URL (`#/workspaces/{id}`) shows welcome content in the main panel; the Session Header Strip remains visible <!-- claim:layout:main-panel-welcome-fallback -->
- Switching between chat and board (or vice versa) follows the active URL — bookmark click, board sidebar click, deep-link, and browser back/forward all swap the main panel content

---

## 3. Chat Panel

### 3.1 Message Display

- Messages grouped into **turns** (user message + assistant response) <!-- claim:chat:turns -->
- Turn shows duration badge (live ticking while active) <!-- claim:chat:duration-badge -->
- Duration format: compact ("5s", "1m 23s", "1h 5m 12s") <!-- claim:chat:duration-format -->
- Error turns have red left border <!-- claim:chat:error-border -->
- Completed turns show final duration <!-- claim:chat:completed-duration -->
- Pending turns render at reduced opacity <!-- claim:chat:pending-opacity -->
- Pending messages are scoped per session — switching sessions clears pending state <!-- claim:chat:pending-session-scoped -->
- Empty state: "Waiting for messages..." <!-- claim:chat:empty-state -->
- Assistant messages rendered as markdown (code blocks, inline code, lists, links, LaTeX math); the same renderer is used for ticket detail content so chat and ticket markdown look identical <!-- claim:chat:markdown -->
- Large sessions with many turns stay responsive: off-screen turns skip rendering work while remaining findable by browser find and selectable across the boundary <!-- claim:chat:lazy-paint -->

**Turn Progress Indicators:**

- Active turn shows spinning ◐ symbol with "Working..." and animated dots <!-- claim:turn:progress-working -->
- When stopping, displays "Stopping..." instead of "Working..." <!-- claim:turn:progress-stopping -->
- Completed turns show green "✓ worked for [duration]" summary; appears only when the current runtime reports cost telemetry <!-- claim:turn:progress-complete --> <!-- claim:cost-display:capability-gated -->
- The compaction indicator appears only while a compaction is in progress, then clears when the compaction completes <!-- claim:chat:compaction-indicator-bounded -->
- The auto-compaction indicator appears only when the current runtime fires pre-compact lifecycle hooks <!-- claim:auto-compact-indicator:capability-gated -->

**Setting Change Dividers:**

- Horizontal divider rendered between turns when model, permission mode, or effort level changes mid-conversation <!-- claim:turn:setting-change-divider -->
- Effort level divider labeled `Effort: <level>` <!-- claim:turn:effort-change-divider -->
- Amber divider appears at the resume point whenever a session resumes with prior messages in the chat; labeled `Restarted` for an ordinary restart, or `Forked from <parent>` on the first viewing of a forked session <!-- claim:turn:container-restart-divider -->

### 3.2 Input Behavior

| Feature             | Behavior                                                                     |
|---------------------|------------------------------------------------------------------------------|
| Auto-resize         | Textarea grows with content, capped at roughly ⅓ of panel height             | <!-- claim:input:autoresize -->
| Scroll compensation | Chat scroll adjusts when textarea shrinks (if not autoscrolling)             | <!-- claim:input:scroll-compensation -->
| Draft persistence   | Draft saved automatically per session                                        | <!-- claim:input:draft-save -->
| Draft restoration   | Only restored when textarea is empty (prevents overwriting user input)       | <!-- claim:input:draft-restore -->
| Draft flush         | Page close triggers immediate save of current draft                          | <!-- claim:input:draft-flush -->
| History             | Up/Down arrows navigate submitted messages; edits update item in-place; persists across page reloads | <!-- claim:input:history-nav -->
| Draft stack         | Down pushes to stack; Up navigates through drafts then history (non-destructive); edits update in-place; submit from draft removes it from stack and adds to history | <!-- claim:input:draft-stack -->
| Selection wrap       | Typing `'`, `"`, `` ` ``, `(`, `[`, or `{` with text selected wraps selection with matching pair; no effect without selection | <!-- claim:input:selection-wrap -->
| Placeholder         | No visible placeholder text                                                  | <!-- claim:input:placeholder -->
| Always enabled      | Textarea is always usable; user can type at any time regardless of session state | <!-- claim:input:always-enabled -->
| Always focused      | Textarea has focus whenever the chat tab is active; focus is preserved when starting a new session, switching sessions, and finishing replay (mobile excepted, where the keyboard would pop up unsolicited) | <!-- claim:input:always-focused -->
| Queue send          | Alt+Enter queues message instead of sending; input clears for next message   | <!-- claim:input:queue-send -->
| Smooth while working | Typing remains smooth and immediate while the agent is working | <!-- claim:input:smooth-during-response -->

### 3.3 Slash Commands

- Typing `/` at the start of the input opens the slash command picker, regardless of whether the input already contains other text <!-- claim:input:slash-trigger -->
- Case-insensitive substring matching <!-- claim:input:slash-fuzzy -->
- Selection inserts command text <!-- claim:input:slash-insert -->
- Accepting a command via Tab or Enter places the caret immediately after the command and its trailing space; any text typed after the partial command is preserved <!-- claim:input:slash-tab-cursor -->
- The slash command picker is available on the welcome screen and lists the workspace's custom commands and skills; in-session it additionally lists MCP and built-in commands <!-- claim:input:slash-autocomplete-on-welcome -->
- The new-session dropdown menu in the main area header is fully visible regardless of which side panels are open <!-- claim:session-header:dropdown-not-clipped -->
- Double-clicking the main area header (outside its interactive controls) toggles the main area's maximize state, mirroring panel-tab double-click behavior <!-- claim:maximize:header-double-click -->
- Clicking the session name in the main area header copies the session directory path to clipboard and flashes a "Copied!" indicator <!-- claim:session-header:click-copies-dir -->
- The session directory tooltip is identical across the main area header, the sessions panel item, and the footer <!-- claim:session-dir-tooltip-uniform -->
- Clicking empty chat space focuses the prompt textarea; clicking message content does nothing and preserves OS-standard text selection (double-click selects the word, drag selects a range) <!-- claim:chat:selection-not-preempted -->
- Stopping the active session immediately deselects it: the main area transitions to the welcome screen and the session appears as stopped in the sessions panel <!-- claim:session:stop-transitions-to-welcome -->
- Slash commands in user messages render with bold weight; recognised commands also show a subtle dotted underline and a hover card with usage, description, and metadata; unrecognised commands render with bold weight only <!-- claim:chat:user-message-slash-command-styling -->
- The slash-command autocomplete appears only when the current runtime supports skills; when unsupported, typing `/` types the literal character with no dropdown <!-- claim:slash-autocomplete:capability-gated -->

### 3.4 Following New Responses

| State                        | Behavior                   |
|------------------------------|----------------------------|
| User near bottom             | View follows new content as it streams in | <!-- claim:chat:autoscroll-bottom -->
| User scrolls               | View stops following immediately and stays where the user left it, even while new content arrives | <!-- claim:chat:autoscroll-disable -->
| User scrolls back to bottom | View resumes following new content; no jump-to-bottom button or other affordance | <!-- claim:chat:autoscroll-reenable -->
| Scroll within code block / nested scrollable | View keeps following; only scrolling the conversation itself stops it | <!-- claim:chat:auto-scroll-ignores-nested-scroll -->
| Click bookmark for active session | Stops following when the resulting position will not be at the bottom; if the target keeps the chat scrolled to the bottom, the view keeps following | <!-- claim:chat:bookmark-click-respects-autoscroll -->
| Tab switch                   | Preserve scroll position   | <!-- claim:chat:autoscroll-tab-switch -->
| Session rename               | Preserve scroll position across rename via chat control bar pencil, sessions panel right-click, or panel-tab right-click | <!-- claim:chat:rename-preserves-scroll -->
| During streaming             | Scrolling feels as smooth as when no response is in flight | <!-- claim:chat:autoscroll-streaming-responsive -->

### 3.5 Pending Messages

- Shown immediately after send (before server confirmation) <!-- claim:turn:pending-show -->
- Removed when server confirms the message <!-- claim:turn:pending-remove -->
- Prevents duplicate display <!-- claim:turn:pending-no-duplicate -->

### 3.6 Chat Control Bar

Control bar at top of Chat panel with two groups: <!-- claim:chat:control-bar -->

**Left group:**

| Control | Icon | Action |
|---------|------|--------|
| Pin | Pin icon | Toggle pinned state for current session; pressed when pinned | <!-- claim:chat:control-pin -->
| Rename | Pencil icon | Enter inline edit mode to rename session; disabled when no session | <!-- claim:chat:control-rename -->
| | | Separator | <!-- claim:chat:control-rename-separator -->
| Reload | Refresh icon | Restart session (picks up config changes) | <!-- claim:chat:control-reload -->
| Compact | Package icon | Send `/compact` message to trigger compaction; appears only when the current runtime supports manual compaction | <!-- claim:chat:control-compact --> <!-- claim:manual-compact-button:capability-gated -->
| Fork | Fork icon | Split-button: main button forks entire session (reuse container); chevron opens dropdown with fork variants. Alt+click or middle-click on the main button forks into a new browser tab. While a fork initiated from this control bar is in flight, the icon shows a spinner and both buttons disable — same as the per-turn rewind control. Appears only when the current runtime supports session forking. | <!-- claim:chat:control-fork --> <!-- claim:fork-button:capability-gated -->
| | | Separator | <!-- claim:chat:control-fork-separator -->
| Session Prompt | Note icon | Toggle dropdown editor for per-session prompt text | <!-- claim:chat:control-session-prompt -->

**Right group:**

| Control | Icon | Action |
|---------|------|--------|
| Previous message | Chevron up | Jump to previous human message | <!-- claim:chat:control-prev -->
| Next message | Chevron down | Jump to next human message | <!-- claim:chat:control-next -->
| | | Separator | <!-- claim:chat:control-jump-separator -->
| Last message | Down-arrow-to-line | Scroll to bottom; pressed+disabled when autoscroll enabled | <!-- claim:chat:control-bottom -->
| | | Separator | <!-- claim:chat:control-nav-separator -->
| Minimap toggle | Map icon | Toggle minimap pinned/transient | <!-- claim:chat:control-minimap -->

### 3.7 Message Timestamps

- Each turn shows timestamp right of duration counter <!-- claim:chat:timestamp -->
- Format: relative ("2m ago", "1h ago"), full datetime on hover <!-- claim:chat:timestamp-format -->
- Timestamp corresponds to when the turn started <!-- claim:chat:timestamp-source -->
- No visual effects on hover (no icon change, no color change) <!-- claim:chat:timestamp-no-hover -->

### 3.8 Collapsible Turns

- Click turn header to collapse/expand <!-- claim:turn:collapsible -->
- Collapsed: full user message + assistant first line + status + metadata <!-- claim:turn:collapsed-content -->
- Collapsed preview strips markdown to plain text (no raw `**bold**`, `# headers`, etc.) <!-- claim:turn:preview-strip-markdown -->
- Collapsed content remains searchable via browser Ctrl+F <!-- claim:turn:collapse-css -->

### 3.9 Input Animations

Chat input border provides ambient state feedback: <!-- claim:input:animation -->

- **Empty and unfocused**: Subtle ripple animation on border <!-- claim:input:anim-idle -->
- **Working**: Color-cycling border animation (shifts through hues) <!-- claim:input:anim-working -->
- **Focus**: Glow box-shadow when focused <!-- claim:input:anim-focus -->
- **Focus color**: Breathing glow effect on border (green) <!-- skip:claim:input:anim-focus-color -->

### 3.10 Mini-map

Conversation overview sidebar (replaces native scrollbar): <!-- claim:chat:minimap -->

**Structure:**
- **Segments**: One segment per compaction period; no gap between segments <!-- claim:chat:minimap-segment-structure -->
- **Sub-bars**: Each turn is a sub-bar within its segment (no vertical gaps between sub-bars) <!-- claim:chat:minimap-sub-bars -->
- Two alternating muted colors (blue-gray and purple) per segment <!-- claim:chat:minimap-alternating-colors -->
- White horizontal lines mark human messages (at start of sub-bar) <!-- claim:chat:minimap-human-lines -->
- Human line height proportional to human message size <!-- skip:claim:chat:minimap-human-lines-proportional -->

**Dimensions:**
- Sub-bar height proportional to actual rendered height of turn content (scrollbar replacement) <!-- claim:chat:minimap-sub-bar-height -->
- Sub-bar width relative to turn processing duration (normalized across turns) <!-- claim:chat:minimap-sub-bar-width -->

**Visibility:**
- Rendered as overlay on top of chat, not at same level <!-- claim:chat:minimap-overlay -->
- Auto show/hide on scrolling <!-- claim:chat:minimap-auto-show-scroll -->
- Auto show/hide when mouse near edge <!-- claim:chat:minimap-auto-show-edge -->
- Transparent appearance (subtle, not distracting) <!-- claim:chat:minimap-transparent -->

**Animation:**
- Show/hide animation: slower than default, smooth curve (not linear) <!-- claim:chat:minimap-animation-curve -->
- Show fades in (0.3s); auto-hides after brief idle or mouse-leave <!-- claim:chat:minimap-animation-delay -->

**Interaction:**
- Click to jump to that position in chat <!-- claim:chat:minimap-click -->
- Drag to scroll continuously <!-- claim:chat:minimap-drag -->
- Visible-area indicator: translucent overlay showing the currently visible portion of the conversation <!-- claim:chat:minimap-viewport -->
- The visible-area indicator slides smoothly as the user scrolls <!-- claim:chat:minimap-thumb-tracks-scroll -->
- On opening a session, each subbar's size reflects its turn's content shape from the start and refines to the final proportion within a few seconds <!-- claim:chat:minimap-warm-from-cold -->

**Toggle:**
- Toggle button in chat control bar (Map icon, after separator, rightmost in right group) <!-- claim:chat:minimap-toggle -->
- Pressed state when minimap is pinned to always-visible <!-- claim:chat:minimap-toggle-pressed -->
- When pinned: minimap stays visible (no auto-hide) <!-- claim:chat:minimap-toggle-persistent -->
- When unpinned: minimap returns to transient show/hide behavior <!-- claim:chat:minimap-toggle-transient -->
- Toggle state persisted per session; default: pinned (always-visible) <!-- claim:chat:minimap-toggle-persist -->

### 3.11 Media Attachments

Attach files/images to messages: <!-- claim:input:attachment -->

| Feature | Behavior |
|---------|----------|
| Drag-drop | Drop zone on input area | <!-- claim:input:attachment-dragdrop -->
| Paste | Ctrl+V in textarea pastes images | <!-- claim:input:attachment-paste -->
| Preview | Preview row above input with remove (×) buttons (thumbnails for images, file icons for others) | <!-- claim:input:attachment-preview -->
| Max size | 10MB per file | <!-- claim:input:attachment-max-size -->
| Supported types | Any file type | <!-- claim:input:attachment-types -->

- Image attachments in message history render correctly <!-- claim:chat:attachment-src -->
- Click image attachment in message history to open zoom overlay <!-- claim:chat:attachment-zoom -->
- Escape, backdrop click, or close button closes zoom overlay <!-- claim:chat:attachment-zoom-close -->

### 3.12 Conversation Rewind

Fork conversation from any human message: <!-- claim:chat:rewind -->

- Rewind button on human messages (top-right, visible on hover); appears only when the current runtime supports session rewinding <!-- claim:chat:rewind-button --> <!-- claim:rewind-button:capability-gated -->
- Split-button: main button forks here (reuse container); chevron opens dropdown with variants <!-- claim:chat:rewind-split -->
- Confirmation modal only when forking in same container while Claude is responding; all other forks execute immediately <!-- claim:chat:rewind-modal -->
- Fork button shows spinner while forking is in progress <!-- claim:chat:fork-spinner -->
- Modal confirm button shows spinner and is disabled while forking is in progress <!-- claim:chat:rewind-modal-spinner -->
- Original session preserved; new session auto-switched <!-- claim:chat:rewind-fork -->
- "Fork here" makes the new session the running one; the original session shows as not-running with its history still viewable; stopping affects only the new session <!-- claim:chat:fork-here-ownership-transfer -->
- "Fork in new tab" and "Fork in new browser tab" leave the original session running and start the new session as its own running session <!-- claim:chat:fork-new-tab-fresh-container -->
- Forked sessions nested under parent in sessions panel <!-- claim:chat:rewind-tree -->
- Forked sessions inherit every parent session setting — name, model, permission mode, effort level, session prompt — plus display metadata (timestamp, turn count, cost, message previews) on creation; values stay until the user changes them in the fork or the fork diverges naturally <!-- claim:chat:fork-metadata-inherit -->

**Fork variants** (available from both rewind button and control bar fork): <!-- claim:chat:fork-variants -->

| Variant | Container | Navigation |
|---------|-----------|------------|
| Fork here | Reuse current container | Replace current view | <!-- claim:chat:fork-here -->
| Fork in new browser tab | New container | Opens in a new browser tab | <!-- claim:chat:fork-browser-tab -->

Full-session fork (control bar only): forks the entire conversation without truncation. Rewind button forks from the clicked message. <!-- claim:chat:fork-full -->

### 3.13 Copy Buttons

Copy buttons at multiple levels:

| Level | Content | Position |
|-------|---------|----------|
| Turn bubble | Full turn content | Top-right of turn | <!-- claim:chat:copy-button-turn -->
| Assistant message | Individual message | Right edge, aligned with message top | <!-- claim:chat:copy-button-message -->
| Code block | Code content | Top-right of code block | <!-- claim:chat:copy-button-code -->

All code blocks in the app have copy buttons (markdown, tool output, commands, etc.).

**User message copy:** <!-- claim:chat:copy-button-user -->

Copying a user message transforms special content to readable form:

| Content | Copied as |
|---------|-----------|
| Slash command | `/command args` | <!-- claim:chat:copy-slash-command -->
| Question response | Q/A text only | <!-- claim:chat:copy-askuser -->
| Command output | Output text only | <!-- claim:chat:copy-stdout -->
| Arbitrary XML | Unchanged | <!-- claim:chat:copy-arbitrary-xml -->

### 3.14 Mermaid Diagrams

Mermaid code blocks render as visual diagrams: <!-- claim:chat:mermaid -->

- ` ```mermaid ` blocks render as SVG diagrams instead of code text <!-- claim:chat:mermaid-render -->
- Toggle button switches between diagram and syntax-highlighted source <!-- claim:chat:mermaid-toggle -->
- Invalid mermaid syntax silently falls back to syntax-highlighted code block <!-- claim:chat:mermaid-fallback -->
- Click diagram to open zoom overlay for inspecting complex diagrams <!-- claim:chat:mermaid-zoom -->
- Escape or backdrop click closes zoom overlay <!-- claim:chat:mermaid-zoom-close -->
- Diagram colors match dark theme palette <!-- claim:chat:mermaid-theme -->
- Copy button copies raw mermaid source <!-- claim:chat:mermaid-copy -->
- Non-mermaid code blocks unaffected <!-- claim:chat:mermaid-no-side-effect -->

### 3.15 Session Prompt

Per-session editable text re-supplied to Claude after each compaction so it persists across long conversations: <!-- claim:chat:session-prompt -->

| Feature | Behavior |
|---------|----------|
| Button | Note icon in control bar left group, after Compact | <!-- claim:chat:session-prompt-button -->
| Blue badge | Dot on button when content is set | <!-- claim:chat:session-prompt-badge -->
| Dropdown editor | Opens below button, left-aligned; textarea with monospace font | <!-- claim:chat:session-prompt-dropdown -->
| Save | Content saved on close (click outside or Escape) | <!-- claim:chat:session-prompt-save -->
| Clear | Empty/whitespace-only text clears the prompt | <!-- claim:chat:session-prompt-clear -->
| Persistence | Survives refresh and resume | <!-- claim:chat:session-prompt-persist -->
| Compaction | After compaction, prompt re-supplied to Claude | <!-- claim:chat:session-prompt-inject -->
| Disabled | Button disabled when no session loaded | <!-- claim:chat:session-prompt-disabled -->

### 3.16 Message Queue

Queue messages for sequential delivery while Claude is responding:

- Queued messages appear as dimmed inline bubbles below the current response <!-- claim:chat:queue-bubble -->
- Queued bubbles show send now (⇒), edit (✎), and cancel (✕) buttons on hover <!-- claim:chat:queue-actions -->
- Send now sends a queued message immediately, skipping queue order <!-- claim:chat:queue-send-now -->
- Queue drains FIFO — each response completion or compaction boundary auto-sends the next queued message <!-- claim:chat:queue-drain -->
- Interrupt pauses all queued messages (won't auto-send) <!-- claim:chat:queue-pause-interrupt -->
- Error pauses all queued messages <!-- claim:chat:queue-pause-error -->
- Paused bubbles show re-queue (▶) and cancel (✕) buttons <!-- claim:chat:queue-pause-actions -->
- Edit returns message content to input textarea; message removed from queue <!-- claim:chat:queue-edit -->
- Cancel removes message from queue <!-- claim:chat:queue-cancel -->
- Re-queue returns paused message to active queue <!-- claim:chat:queue-requeue -->
- Enter sends immediately, bypassing queue; queued messages send after response completes <!-- claim:chat:queue-bypass -->
- Session switch restores that session's queued messages from storage <!-- claim:chat:queue-session-clear -->
- Queue persists per session; survives page refresh <!-- claim:chat:queue-persist -->
- Queued messages preserve attachments <!-- claim:chat:queue-attachments -->

---

## 4. Tool Display

> **Note**: Wireframes in this section are schematic. Actual rendering uses CSS-styled elements (colored bullets, borders, animations) rather than the literal symbols shown.

### 4.1 Tool Block Structure

```
[Icon] Tool Name | Summary
────────────────────────────
Expanded content (if clicked)
```

**Tool Bullet Colors:**

- Pending: cyan with pulsing animation <!-- claim:tool:bullet-pending -->
- Completed: green (solid) <!-- claim:tool:bullet-complete -->
- Error: red <!-- claim:tool:bullet-error -->

### 4.1.1 Block Timing

Each block shows inline timing information in the header line: <!-- claim:tool:block-timing -->

- **Completed tool blocks**: offset only, e.g. `@ +8s` <!-- claim:tool:timing-tool -->
- **Thinking blocks**: relative offset only, e.g. `@ +3s` <!-- claim:tool:timing-thinking -->
- **Pending tool blocks**: duration after 30s + offset, e.g. `32s · @ +8s` <!-- claim:tool:timing-live -->
- **Background tasks**: no timing displayed (tracked in Tasks panel) <!-- claim:tool:timing-async-skip -->
- **Nested tool blocks**: timing relative to parent turn start <!-- claim:tool:timing-nested -->
- Timing displayed right-aligned in the header line, muted color <!-- claim:tool:timing-style -->
- Relative offset = time from turn start to block completion (or start if pending) <!-- claim:tool:timing-offset -->

### 4.2 Tool-Specific Formatting

| Tool            | Header                         | Summary                                  |
|-----------------|--------------------------------|------------------------------------------|
| Read            | `Read(filename)`               | Line count; warning if present           | <!-- claim:tool:read -->
| Edit            | `Edit(filename)`               | Diff summary ("+N, -M")                  | <!-- claim:tool:edit -->
| Write           | `Write(filename)`              | "Wrote N lines"                          | <!-- claim:tool:write -->
| Bash            | `Bash(command)`                | Line count, output preview (single-line), or "Done" (empty) | <!-- claim:tool:bash -->
| Grep            | `Grep(pattern)` or `Grep(pattern:path)` | Context-aware count (see below)          | <!-- claim:tool:grep -->
| Glob            | `Glob(pattern)`                | File count                               | <!-- claim:tool:glob -->
| Task            | `Task(description)`            | Status/first line                        | <!-- claim:tool:task -->
| Skill           | `Skill(name)`                  | "Launching skill: {name}"                | <!-- claim:tool:skill -->
| WebFetch        | `WebFetch(url)`                | First line of result                     | <!-- claim:tool:webfetch -->
| WebSearch       | `WebSearch(query)`             | First line of result                     | <!-- claim:tool:websearch -->
| TodoWrite       | `TodoWrite`                    | Diff counts: `●2 ◐1 ○3 ✕1`               | <!-- claim:tool:todowrite -->
| MCPSearch       | `MCPSearch`                    | "Tool loaded" or "Found N tools"         | <!-- claim:tool:mcpsearch -->
| AskUserQuestion | `AskUserQuestion(N questions)` | Question count                           | <!-- claim:tool:askuser -->
| ExitPlanMode    | `ExitPlanMode(title)`          | Plan title (first heading, truncated if long) | <!-- claim:tool:exitplan -->
| TaskOutput      | `TaskOutput(task_id)`          | Status: Running/Completed/Failed/Timeout/Killed | <!-- claim:tool:taskoutput -->

**Skill Output:**

- Skill body content displays inside the Skill tool block's expandable content <!-- claim:tool:skill-content-folds -->
- Skill body stays attached to its tool block regardless of intervening tool results <!-- claim:tool:skill-content-tool-result-intervening -->

**Saved Output:**

- Large tool results show file path and size <!-- claim:tool:persisted-output -->
- Preview content displayed when expanded <!-- claim:tool:persisted-preview -->
- Very large tool output truncated; truncated blocks show expand and download buttons <!-- claim:tool:output-truncation -->
- Download button on saved-output blocks <!-- claim:tool:output-download -->

**Background Tasks:**

- Background tasks show "Background task running" status <!-- claim:tool:task-background -->
- Output file path displayed as informational text <!-- claim:tool:task-background-path -->

**Grep Output:**

Summary varies by output mode: <!-- claim:tool:grep-summary-modes -->

| Mode | Summary Format |
|------|----------------|
| files_with_matches (default) | "X files" | <!-- claim:tool:grep-summary-files -->
| content | "X matches" | <!-- claim:tool:grep-summary-matches -->
| count | "X files with matches" | <!-- claim:tool:grep-summary-count -->

Visual styling for expanded Grep output: <!-- claim:tool:grep-visual -->

- Match lines (`:` separator): highlighted background with left border accent <!-- claim:tool:grep-visual-match -->
- Context lines (`-` separator): dimmed text (reduced opacity) <!-- claim:tool:grep-visual-context -->
- Highlight extends full line width on horizontal scroll <!-- claim:tool:grep-visual-scroll -->
- Pagination metadata stripped from output <!-- claim:tool:grep-pagination-hidden -->

### 4.2.1 File Path Display

- File tools (Read/Edit/Write) show filename only in collapsed header <!-- claim:tool:file-collapsed -->
- Collapsed: hover shows full path in tooltip <!-- claim:tool:file-tooltip -->
- Expanded: header shows full path instead of filename <!-- claim:tool:file-expanded -->
- `/tmp` paths highlighted across all content (tool output, messages, code blocks); click copies path <!-- claim:tool:tmp-path-highlighting -->
- General file paths highlighted when resolved to unique workspace match; click copies absolute path <!-- claim:tool:general-path-highlighting -->

### 4.3 Interactive Tools

**AskUserQuestion:**

- Renders form with single or multi-select options <!-- claim:tool:askuser-form -->
- Always includes "Other" with text input <!-- claim:tool:askuser-other -->
- "Other" textarea auto-resizes as user types (like main chat input) <!-- claim:tool:askuser-other-autoresize -->
- No placeholder hint text in "Other" textarea <!-- claim:tool:askuser-no-placeholder -->
- Submit button disabled until user makes a selection <!-- claim:tool:askuser-submit-disabled -->
- Selecting "Other" option auto-focuses the text input <!-- claim:tool:askuser-other-focus -->
- Submit sends answer <!-- claim:tool:askuser-submit -->
- User's selection shown immediately after submit <!-- claim:tool:askuser-optimistic -->
- After submit, highlight what was answered (selected option or custom text) <!-- claim:tool:askuser-highlight-answer -->
- Tool block collapses after submitting response <!-- claim:tool:askuser-collapse-after-submit -->
- Q/A visual separation: visually distinguish questions from answers, separate pairs <!-- claim:tool:askuser-qa-separation -->
- Previously answered questions show read-only "Answered" display <!-- claim:tool:askuser-answered -->
- Form disabled when follow-up human message exists in conversation <!-- claim:tool:askuser-disable-after-reply -->

**ExitPlanMode:**

- Displays plan content as markdown <!-- claim:tool:exitplan-markdown -->
- Default expanded for user review <!-- claim:tool:exitplan-expanded -->
- Approve/Reject form rendered below plan content <!-- claim:tool:exitplan-form -->
- Approve and Reject options, plus "Other" for free-text feedback <!-- claim:tool:exitplan-options -->
- Submit button disabled until user makes a selection <!-- claim:tool:exitplan-submit-disabled -->
- Submit sends the response <!-- claim:tool:exitplan-submit -->
- Summary shows "Approved", "Rejected", or "Answered" based on selection <!-- claim:tool:exitplan-answer-label -->
- Plan content re-expandable after answering (unlike AskUserQuestion) <!-- claim:tool:exitplan-stays-viewable -->
- Form hidden after submit; block auto-collapses <!-- claim:tool:exitplan-collapse-after-submit -->
- Form disabled when follow-up human message exists in conversation <!-- claim:tool:exitplan-disable-after-reply -->

### 4.4 Nested Tool Blocks

- Task tool can contain nested tool calls <!-- claim:tool:nested-task -->
- Displayed as indented tree with connectors <!-- claim:tool:nested-tree -->
- Auto-collapse when task completes <!-- claim:tool:nested-collapse -->

### 4.4.1 Realtime Nested Display

Nested tool calls in Task blocks display progressively in real-time: <!-- claim:tool:nested-realtime -->

| Event | Display |
|-------|---------|
| New nested tool call | Nested block appears with pending spinner | <!-- claim:tool:nested-tool-use -->
| Nested tool completes | Nested block updates with result summary | <!-- claim:tool:nested-tool-result -->

**Behavior:**

- Task blocks expanded by default during execution <!-- claim:tool:task-expanded-default -->
- Nested tools visible immediately, not deferred until Task completion <!-- claim:tool:nested-immediate -->
- Pending nested tools show cyan pulsing bullet with spinner <!-- claim:tool:nested-pending-spinner -->
- Completed nested tools show green bullet with result summary <!-- claim:tool:nested-complete-green -->
- User can collapse Task during execution <!-- claim:tool:task-collapse-count -->

**Collapsed Task during execution:**
```
◐ Task(description)                                                      [▶]
└ Working...
```

**Expanded Task during execution:**
```
◐ Task(description)                                                      [▼]
  ● Read /src/file.py              <- completed
  └ Read 50 lines
  ◐ Grep "pattern" in /src         <- in progress
  └ 🔄
└ Working...
```

### 4.5 Expandable Content

- Click tool header to expand/collapse <!-- claim:tool:expand-click -->
- Collapsible content based on content length <!-- claim:tool:expand-threshold -->
- Default collapsed: JSON, Read, Grep, Skill, WebSearch, WebFetch, TodoWrite, TaskOutput, completed Task with nested <!-- claim:tool:expand-default-collapsed -->
- Default expanded: AskUserQuestion, ExitPlanMode <!-- claim:tool:expand-default-expanded -->

### 4.6 Thinking Blocks

- Clickable header shows first line as preview (truncated with ellipsis, no quotes) <!-- claim:tool:thinking-preview -->
- Expands to show full content as formatted Markdown <!-- claim:tool:thinking-expand -->
- Expanded content replaces the ellipsized preview line in place <!-- claim:tool:thinking-expand-inline -->
- Uses hollow circle bullet (○) to distinguish from tools <!-- claim:tool:thinking-bullet -->

### 4.7 Compaction Blocks

- Displayed when context compaction occurs <!-- claim:tool:compaction-display -->
- Shows `128K tokens, auto_compact` on one line (token count + trigger reason) <!-- claim:tool:compaction-tokens --> <!-- claim:tool:compaction-reason -->
- Expandable summary of what was compacted <!-- claim:tool:compaction-summary -->
- Uses circled dot bullet (◎), animated spinner while compacting <!-- claim:tool:compaction-bullet -->


### 4.8 Tool Input Display

- Hover on tool header shows full input as tooltip (always available) <!-- claim:tool:input-hover -->
- Bash tool: single-line command shown in header only (no duplicate input section when expanded) <!-- claim:tool:input-bash-dedup -->
- Unhandled tools (no specialized formatter) show tool input as collapsible "Input" section in expanded content <!-- claim:tool:input-unhandled-section -->
- Input section rendered above tool output <!-- claim:tool:input-above-output -->
- Input section expanded by default when tool block is expanded <!-- claim:tool:input-default-expanded -->
- Input section visible while tool is pending (shows what was sent before result arrives) <!-- claim:tool:input-pending-visible -->
- Input section is omitted when the tool input is empty (`{}`) <!-- claim:tool:input-empty-hidden -->
- Handled tools (Read, Edit, Write, Bash, Grep, Glob, Task, etc.) use their specialized formatters and omit the generic input section <!-- claim:tool:input-handled-skip -->
- Unhandled tools wrap output in collapsible "Output" section (symmetric with "Input" section) <!-- claim:tool:output-unhandled-section -->

### 4.9 Todos Details

- When several task creations or updates land in a row from the same source, the chat shows them together inside a single "Todos" panel; inspection-only task actions (looking up an existing list) render as ordinary tool blocks instead. When another action appears between two task updates, the chat shows a separate "Todos" panel before and after it <!-- claim:tool:todos-block-grouped -->
- The "Todos" panel uses the standard tool-block chrome: a header line showing the label `Todos` and a summary line showing a count for each state that has at least one task; the panel opens expanded and clicking the header collapses the row body <!-- claim:tool:todos-block-collapsed -->
- Each task appears once on its own row, showing its latest state from that group of updates <!-- claim:tool:todos-block-diff-only -->
- A task waiting on another task shows `⊘`; once everything it waits on is done, the icon goes back to the task's own state icon <!-- claim:tool:todos-block-blocked-icon -->
- State icons: `○` pending, `◐` in progress, `●` completed, `✕` removed <!-- claim:tool:todos-block-status -->
- Removed tasks appear muted with strikethrough <!-- claim:tool:todos-block-removed -->
- When a task has a description, the description appears in a third column on the same row as the title, truncating with an ellipsis when it overflows; hovering the description surfaces the full text <!-- claim:tool:todos-block-item-subtitle -->
- Rows in the "Todos" panel align across the group: the state-icon column, the title column, and the description column have the same width on every row <!-- claim:tool:todos-block-grid-columns -->
- The "Todos" panel opens with its row body visible; collapsing it folds the rows away <!-- claim:tool:todos-block-default-expanded -->

- Task prompt expanded by default for running tasks; auto-collapses when task completes; past completed tasks show collapsed with truncated first-line preview <!-- claim:tool:task-prompt-collapsed -->
- Click prompt header to reveal full multi-line prompt text <!-- claim:tool:task-prompt-content -->

### 4.10 Task Block Behavior

- Click anywhere on Task header to expand/collapse <!-- claim:tool:task-click-expand -->
- Loading spinner vertically aligned with text <!-- claim:tool:task-spinner-align -->

### 4.11 Write Tool Display

Match Read tool styling: <!-- claim:tool:write-display -->

- Show actual written content, not just success message <!-- claim:tool:write-show-content -->
- Syntax highlighting based on file extension (`.py` → Python, `.js` → JavaScript) <!-- claim:tool:write-syntax-highlight -->
- Same line number gutter styling as Read <!-- claim:tool:write-line-numbers -->
- Verbose confirmation header not shown; content displayed directly <!-- claim:tool:write-strip-header -->

### 4.11.1 Edit Diff Display

Inline character highlighting for changes: <!-- claim:tool:edit-diff-inline -->

- Consecutive add/remove line pairs show word-level diff <!-- claim:tool:edit-diff-word -->
- Changed characters within paired lines highlighted (like GitHub word-diff) <!-- claim:tool:edit-diff-highlight -->
- Unrelated add/remove lines show full-line highlighting <!-- claim:tool:edit-diff-fullline -->

### 4.12 System Reminders

Extract and render system reminders separately: <!-- claim:tool:reminder -->

- System reminders extracted from main content <!-- claim:tool:reminder-strip -->
- Render each unique reminder as separate collapsible section <!-- claim:tool:reminder-separate -->
- Default collapsed with "System reminder" label <!-- claim:tool:reminder-collapsed -->
- Identical reminders deduplicated by exact text match; shown once with ×N count badge <!-- claim:tool:reminder-dedup -->
- Header shows count of unique reminders <!-- claim:tool:reminder-unique-count -->
- Applies to all tool results and message content <!-- claim:tool:reminder-scope -->

### 4.13 Tool Error Display

- Error message shown in red subtitle line <!-- claim:tool:error-subtitle -->
- When full error fits in subtitle, suppress duplicate code block below <!-- claim:tool:error-no-duplicate -->

### 4.14 Read Tool Line Numbers

- All lines aligned consistently (first line not misaligned) <!-- claim:tool:read-line-align -->
- Line numbers right-aligned in gutter <!-- claim:tool:read-line-gutter -->

### 4.14.1 Code Block Gutter Behavior

Applies to Grep, Read, Write tool output: <!-- claim:tool:codeblock-gutter -->

- Gutter is sticky during horizontal scroll <!-- claim:tool:codeblock-sticky -->
- Gutter width matches the highest line number in the block (3-character minimum), constant across every row <!-- claim:tool:codeblock-gutter-width -->
- Gutter background extends to all container edges (no gaps at corners) <!-- claim:tool:codeblock-gutter-edges -->
- Line highlighting: match/active lines have distinct background, gutter accent <!-- claim:tool:codeblock-highlight -->

### 4.15 Local Command Output

Render command output blocks from user messages: <!-- claim:tool:localcmd -->

- Collapsible, expanded by default <!-- claim:tool:localcmd-expanded -->
- Header shows "stdout" or "stderr" based on content type <!-- claim:tool:localcmd-header -->
- stderr content in red/warning styling <!-- claim:tool:localcmd-stderr -->
- Markup stripped from visible content <!-- claim:tool:localcmd-strip-tags -->

### 4.16 Background Task Notifications

Background tasks show status updates in the original Tool block: <!-- claim:tool:bgtask -->

| Status | Icon | Color | Summary |
|--------|------|-------|---------|
| running | ● (cyan pulse) | default | "Background task running" | <!-- claim:tool:bgtask-running -->
| completed | ● (green) | green | Summary text | <!-- claim:tool:bgtask-completed -->
| failed | ● (red) | red | Summary text | <!-- claim:tool:bgtask-failed -->
| killed | ● (yellow) | yellow | Summary text | <!-- claim:tool:bgtask-killed -->

- Task notification markup stripped from user messages <!-- claim:tool:bgtask-strip-xml -->
- Status updates correlate to their originating task across turns <!-- claim:tool:bgtask-correlation -->

### 4.17 Background Task Consolidated Rendering

Render background tasks as single consolidated blocks: <!-- claim:tool:bgtask-consolidated -->

- Single block per background task (like synchronous Task rendering) <!-- claim:tool:bgtask-single-block -->
- A single block covers the entire background task's tool calls and output <!-- claim:tool:bgtask-no-multi-block -->
- TaskOutput blocks still appear inline in assistant messages for narrative flow <!-- claim:tool:bgtask-inline-taskoutput -->
  - Example: "Let me check again:" → `● TaskOutput(ab58f94) └ Completed`
- Clicking in-progress tasks expands to show details <!-- claim:tool:bgtask-click-expand -->

### 4.17.1 Background Task Nested Tools

Background tasks show nested tool calls streaming in real-time, identical to foreground tasks: <!-- claim:tool:bgtask-nested-events -->

- Nested tools appear with spinner as they start <!-- claim:tool:bgtask-nested-spinner -->
- Nested tools show result summary when complete <!-- claim:tool:bgtask-nested-complete -->
- Visible immediately during background execution <!-- claim:tool:bgtask-nested-immediate -->
- Preserved after session reload <!-- claim:tool:bgtask-nested-resume -->

**Wireframe:**

```
● Task(background-research)                [ab58f94] ⟳
├─ Prompt: "Research the codebase..."
├─ ● Read(/src/file.py)                           ✓
│  └ Read 50 lines
├─ ◐ Grep("pattern")                              ⟳
│  └ 🔄
└─ Status: Running in background
```

### 4.18 Code Block Rendering

Tool output with code or text content: <!-- claim:tool:codeblock-detect -->

- Known file types: syntax highlighted by extension <!-- claim:tool:codeblock-extension -->
- Unknown content: auto-detected language, highlighted if recognized <!-- claim:tool:codeblock-auto -->
- Markdown files and markdown-like output render as formatted text (headings, lists, links) instead of raw code <!-- claim:tool:markdown-auto-render -->
- Hovering a markdown block reveals a toolbar with a source toggle and copy button <!-- claim:tool:markdown-toolbar -->
- Source toggle switches between rendered markdown and syntax-highlighted code view <!-- claim:tool:markdown-toggle -->
- Copy button copies the raw markdown source <!-- claim:tool:markdown-copy -->
- Plain text: displayed as monospace text <!-- claim:tool:codeblock-fallback -->

---

## 5. Sessions Panel

### 5.1 Session List

- Shows all sessions (newest first) <!-- claim:panel-session:list-order -->
- Each row: status dot (green/gray), ID (first 8 chars) + name (if set), time ago, turns, cost <!-- claim:panel-session:row-content --> <!-- claim:panel-session:container-dot -->
- Resume button (Play icon) shows a spinner from click until the tab switch / new browser tab paints; disabled while spinning <!-- claim:panel-session:resume-spinner -->
- Hovering turns / cost / each timestamp segment reveals informative tooltips: "Turns — N", "API cost this session — $X.XX", "Started — …", "Last active — …" <!-- claim:panel-session:meta-tooltips -->
- Clicking session ID copies full session directory path to clipboard; shows "Copied!" briefly <!-- claim:panel-session:copy-id -->
- Preview of first and last messages (last prefixed with "...") <!-- claim:panel-session:preview -->
- Auto-refresh when sessions change <!-- claim:panel-session:auto-refresh -->
- Current session row highlighted <!-- claim:panel-session:current-highlight -->
- Loading state: "Loading..." <!-- claim:panel-session:loading -->
- Error state: "Failed to load sessions" with Retry button <!-- claim:panel-session:error -->
- Empty state: "No sessions yet" <!-- claim:panel-session:empty -->
- Sessions with 0 turns hidden from list (except active session) <!-- claim:panel-session:hide-empty -->
- Three-tier sort: pinned first, then unpinned-with-container by max descendant timestamp, then unpinned-without-container by max descendant timestamp <!-- claim:panel-session:sort-tiers -->
- Fork activity bubbles up via max timestamp across all descendants <!-- claim:panel-session:fork-sort-key -->
- After "Fork here", the running indicator moves from the original session to the new one; the stop button hides on the original session <!-- claim:panel-session:fork-here-running-indicator -->
- Active fork auto-expands ancestor chain in session tree; pinned active session collapses all <!-- claim:panel-session:auto-expand-ancestors -->
- Hover on truncated session name shows full name in tooltip <!-- claim:panel-session:tooltip-truncated -->

### 5.2 Actions

| Action | Behavior                                                     |
|--------|--------------------------------------------------------------|
| Resume | Load session, reconnect, focus chat; progress bar during hydration | <!-- claim:panel-session:resume -->
| New    | Create blank session, reconnect, focus chat              | <!-- claim:panel-session:new -->
| Rename | Inline edit field; Save (✓) and Cancel (✕) buttons; clicking away cancels | <!-- claim:panel-session:rename -->
| Kill   | Stop session; spinner and disabled while stopping; visible only when session has a container | <!-- claim:panel-session:kill-container -->

**Panel Buttons:**

- New (+) button: Creates new session (in panel header); Alt+Click or middle-click opens in new browser tab <!-- claim:panel-session:new-button -->
- Refresh button: Reloads session list (in panel header) <!-- claim:panel-session:refresh-button -->
- Edit button: Revealed on row hover for rename action <!-- claim:panel-session:edit-button -->
- Kill button: Stop icon, revealed on row hover when session has a container; red on hover; spinner and disabled while stopping <!-- claim:panel-session:kill-button -->

### 5.3 Display Format

- Time: "just now" (<1m), "Xm ago", "Xh ago", "Xd ago" (<7d), then full date <!-- claim:panel-session:time-format -->
- Time range: "started → updated" when different <!-- claim:panel-session:time-range -->
- Cost: USD with 2 decimal places (`$X.XX`), `$X.XXK` for ≥$1K; em dash if null <!-- claim:panel-session:cost-format -->
- Turns: "X turns", "—" if null <!-- claim:panel-session:turns-format -->
- Messages: truncated with ellipsis <!-- claim:panel-session:message-truncate -->

### 5.4 Pinned Sessions

- Pin button left of resume icon <!-- claim:panel-session:pin-button -->
- Orange when pinned, muted when unpinned <!-- claim:panel-session:pin-color -->
- Pinned sessions sorted to top, maintain original order within pinned group <!-- claim:panel-session:pin-order -->
- Pinned state persists across sessions <!-- claim:panel-session:pin-storage -->

### 5.5 Resume Button

- Split-button: Play icon (▶) resumes session in current tab; chevron opens dropdown with "Resume session" and "Resume in new browser tab" <!-- claim:panel-session:resume-button -->
- Middle-click on Play button resumes session in new browser tab <!-- claim:panel-session:resume-middle-click -->

---

## 6. Boards Panel & Ticket Board

### 6.1 Boards Panel (Right Strip)

Right-strip panel listing discovered boards per workspace: <!-- claim:panel-boards:panel -->

- Boards icon in right strip, below Bookmarks <!-- claim:panel-boards:icon-position -->
- Lists all boards discovered in the workspace <!-- claim:panel-boards:discovery -->
- Each board shows name and file path <!-- claim:panel-boards:item-display -->
- Hover reveals pencil icon to rename board inline (Save/Cancel buttons) <!-- claim:panel-boards:rename -->
- Clicking a board opens its board view in the main panel; the URL updates to `#/workspaces/{id}/boards/{boardId}` <!-- claim:panel-boards:open-tab -->
- Alt+click or middle-click a board item opens it in a new browser tab <!-- claim:panel-boards:open-new-browser-tab -->
- Deep-link URL of the form `#/workspaces/{id}/boards/{id}` selects the workspace before opening the board, so the board renders fully populated <!-- claim:panel-boards:deep-link-loads-board -->
- Refresh meta-item appears at the end of the list (and below the "No boards found" placeholder in the empty state); tapping it reloads the board list <!-- claim:panel-boards:meta-refresh -->
- The panel has no dedicated header row — boards begin at the top of the panel <!-- claim:panel-boards:no-header -->
- On fresh page load before a workspace is selected, the panel shows the loading state — never a raw error message <!-- claim:panel-boards:pre-workspace-loading -->
- Loading state: panel-level italic muted "Loading..." text matching the canonical empty-state styling <!-- claim:panel-boards:loading -->
- Error state: "Failed to load boards" — centered, italic, red <!-- claim:panel-boards:error -->
- Empty state: "No boards found" — centered, italic <!-- claim:panel-boards:empty -->

### 6.2 Board Layout

Ticket board displays in the main panel with 6 columns and horizontal swimlane bands: <!-- claim:board:layout -->

**Columns (left to right):**

| Column | Display Name |
|--------|-------------|
| backlog | Backlog | <!-- claim:board:col-backlog -->
| in-progress | In Progress | <!-- claim:board:col-in-progress -->
| review | Review | <!-- claim:board:col-review -->
| done | Done | <!-- claim:board:col-done -->
| rejected | Rejected | <!-- claim:board:col-rejected -->
| definitely-rejected | Def. Rejected | <!-- claim:board:col-def-rejected -->

- Terminal columns (Done, Rejected, Def. Rejected) collapsed by default with ▸ toggle <!-- claim:board:terminal-collapsed -->
- Click ▸/▾ to expand/collapse any column <!-- claim:board:terminal-toggle -->
- Non-terminal columns expanded by default <!-- claim:board:non-terminal-expanded -->
- Column headers have drag handle (visible on hover) for horizontal drag-and-drop reorder <!-- claim:board:col-dnd-reorder -->
- Column header context menu: Move left, Move right, separator, "Archive all tickets in [State] state (N tickets)" <!-- claim:board:col-context-menu -->
- Collapsed column headers show the first grapheme of the state label, anchored to the top of the rotated strip <!-- claim:board:collapsed-header-grapheme -->
- Collapsed cells render only the ticket count; cells with zero tickets are blank <!-- claim:board:collapsed-cell-count-only -->
- Right-clicking a cell (state × swimlane intersection) opens "Archive all tickets in [State] state and [Swimlane] swimlane (N tickets)" <!-- claim:board:cell-context-menu -->

### 6.3 Swimlanes

Horizontal bands spanning all columns, grouping tickets by category: <!-- claim:board:swimlanes -->

- Named swimlanes from the board configuration displayed in order <!-- claim:board:swimlane-order -->
- Click ▸/▾ chevron on swimlane header to collapse/expand (hides cards when collapsed) <!-- claim:board:swimlane-collapse -->
- Tickets without a swimlane appear in "(Unsorted)" lane at bottom <!-- claim:board:swimlane-unsorted -->
- Swimlane headers have drag handle (visible on hover) for vertical drag-and-drop reorder <!-- claim:board:swimlane-dnd-reorder -->

**Swimlane CRUD:**

| Action | Mechanism |
|--------|-----------|
| Create | "Add swimlane" button at bottom of board → click → inline name input | <!-- claim:board:swimlane-create -->
| Rename | Double-click swimlane header → inline edit; Enter saves, Escape cancels | <!-- claim:board:swimlane-rename -->
| Delete | Right-click header → context menu → "Delete"; tickets move to (Unsorted) | <!-- claim:board:swimlane-delete -->
| Reorder | Right-click header → context menu → "Move up" / "Move down"; or drag handle | <!-- claim:board:swimlane-reorder -->

- Context menu on swimlane header: Rename, Delete, separator, Move up, Move down, separator, "Archive all tickets in [Swimlane] swimlane (N tickets)" <!-- claim:board:swimlane-context-menu -->
- Unsorted lane is read-only: rename, delete, and the swimlane context menu apply only to user-defined swimlanes <!-- claim:board:swimlane-unsorted-readonly -->

### 6.4 Ticket Cards

Each ticket rendered as a card in its column × swimlane cell: <!-- claim:board:card -->

- Card shows ticket title (from first `#` heading, fallback to filename) <!-- claim:board:card-title -->
- Cards with an assigned session show status indicator: dot + status text + truncated session ID <!-- claim:board:card-session -->
- Session status dot: green (running), gray (stopped/no container) <!-- claim:board:card-session-dot -->
- Click card to open detail overlay <!-- claim:board:card-click-detail -->
- Ctrl+click / Cmd+click to toggle multi-select <!-- claim:board:card-multi-select -->

### 6.5 Drag and Drop

- Drag card between columns to move ticket <!-- claim:board:drag-column -->
- Dragging a selected ticket carries every selected ticket with it; dragging an unselected ticket moves only that ticket (selection unchanged); bulk drag also reorders within the destination cell, preserving the relative order between selected tickets <!-- claim:board:drag-bulk-selected -->
- Tickets within a cell can be reordered vertically by dragging; the new order persists across reload <!-- claim:board:intra-cell-reorder -->
- Dropping a ticket between two existing cards in a cell inserts it at that slot rather than appending at the end <!-- claim:board:drop-index-insertion -->
- Bulk move into an active column spawns a single shared session for all moved tickets, reassigning every selected ticket to it; the prompt sequence's `{ticket}` placeholder expands to a newline-separated list of all moved tickets <!-- claim:board:bulk-shared-session -->
- Drag card into collapsed columns (drop target highlights on hover) <!-- claim:board:drag-collapsed -->
- Drag card between swimlanes to reassign swimlane <!-- claim:board:drag-swimlane -->
- When the multi-selection spans multiple swimlanes, moving the selection keeps each ticket in its original swimlane (only the column changes); when every selected ticket is in the same swimlane, the target swimlane is respected <!-- claim:board:cross-lane-bulk-preserve -->
- Dropping a ticket on a column header moves it to that column without changing its swimlane <!-- claim:board:column-header-drop -->
- Double-clicking a column header opens an inline input to rename the column's display label; Enter or blur saves, Escape discards; empty/whitespace input reverts to the prior label; renaming changes only the display label, not folder paths or ticket file locations <!-- claim:board:column-rename -->
- Drag column headers horizontally to reorder columns <!-- claim:board:drag-col-reorder -->
- Drag swimlane headers vertically to reorder swimlanes <!-- claim:board:drag-lane-reorder -->
- Drag ghost follows cursor during drag <!-- claim:board:drag-overlay -->
- Moving a ticket to an active column (e.g. In Progress) auto-creates a session if none assigned <!-- claim:board:auto-assign -->
- Auto-created session receives the board's configured `prompt.sequence` as user messages, with `{ticket}` substituted by the ticket path <!-- claim:board:prompt-sequence-delivered -->

### 6.6 Ticket Detail Overlay

Read-only overlay showing ticket content: <!-- claim:board:detail -->

- Title displayed in header <!-- claim:board:detail-title -->
- Metadata: status (display label), swimlane (display name), session (ID + status or "—") <!-- claim:board:detail-meta -->
- Full ticket file rendered as formatted markdown <!-- claim:board:detail-content -->
- Loading state: "Loading..." while fetching content <!-- claim:board:detail-loading -->
- Close with × button or Escape key <!-- claim:board:detail-close -->
- Click backdrop to close <!-- claim:board:detail-backdrop -->

### 6.7 Multi-Select

- Ctrl+click / Cmd+click toggles ticket selection <!-- claim:board:multi-select -->
- Checkbox click toggles selection without clearing other selections <!-- claim:board:checkbox-select -->

### 6.8 Archive

- Right-click card opens context menu with "Archive ticket" option <!-- claim:board:archive-context -->
- Right-click column header → "Archive all tickets" bulk-archives all tickets in that column <!-- claim:board:archive-bulk-column -->
- Right-click swimlane header → "Archive all tickets" bulk-archives all tickets in that lane <!-- claim:board:archive-bulk-swimlane -->
- Archive removes the ticket from the board view; file stays in place <!-- claim:board:archive-behavior -->
- No confirmation dialog <!-- claim:board:archive-no-confirm -->

### 6.9 Loading & Error States

| State | Display |
|-------|---------|
| Board loading | Spinner centered: "Loading board..." | <!-- claim:board:loading -->
| Parse failure | "Failed to parse board.yaml: {error}" | <!-- claim:board:error -->
| No board data | Nothing rendered (null) | <!-- claim:board:no-data -->

### 6.10 Real-Time Updates

- Board auto-refreshes when board contents change <!-- claim:board:sse-update -->
- Board auto-refreshes when session status changes <!-- claim:board:sse-session -->

### 6.11 Density Modes

- A control-bar button switches the board between comfortable (cards) and terse (inline ticket-ID links) layouts; the choice is reflected in the URL <!-- claim:board:density-toggle -->
- In terse mode, each cell shows tickets as comma-separated wrapping ID links; clicking a link opens the ticket detail; tickets with attached sessions are colored differently. Each link's text is the ticket-file name's prefix before the first hyphen, supporting alphanumeric IDs (e.g. `1.04.A`) <!-- claim:board:terse-layout -->

---

## 7. Stash Panel

### 7.1 Purpose

Temporary text clipboard for storing/retrieving prompts.

### 7.2 Items

- Stored per-session <!-- claim:panel-stash:storage -->
- Items displayed newest first (stack order) <!-- claim:panel-stash:stack-order -->
- Show first line as preview (truncated) <!-- claim:panel-stash:preview -->
- Hover shows full text in tooltip <!-- claim:panel-stash:tooltip -->
- Empty/whitespace-only text rejected when stashing <!-- claim:panel-stash:reject-empty -->

### 7.3 States

- Empty: "No stashed items" with "Ctrl+S to stash" hint (no full footer) <!-- claim:panel-stash:empty-state -->
- Footer (non-empty): "Ctrl+S to stash | Ctrl+Shift+S to pop" <!-- claim:panel-stash:footer -->

### 7.4 Actions

| Action              | Behavior                          |
|---------------------|-----------------------------------|
| Click copy button   | Copy to clipboard (keep in stash) | <!-- claim:panel-stash:copy-button -->
| Click remove button | Remove item and insert into input | <!-- claim:panel-stash:remove-button -->

**Button Icons:**

- Copy button: Copy icon with tooltip "Copy" <!-- claim:panel-stash:copy-tooltip -->
- Remove button: Arrow icon with tooltip "Insert into input and remove" <!-- claim:panel-stash:remove-tooltip -->

**Edge Cases:**

- Pop with empty stash: no effect <!-- claim:panel-stash:pop-empty -->

---

## 7. Todos Panel

### 8.1 Display

- Read-only list showing current todos <!-- claim:panel-todo:readonly -->
- Each row shows the state icon and the task title <!-- claim:panel-todo:row-minimal -->
- State icons: ○ (pending), ◐ (in progress), ● (completed) <!-- claim:panel-todo:status-icons -->
- Completed items show strikethrough text <!-- claim:panel-todo:strikethrough -->
- Empty state: "No todos yet" <!-- claim:panel-todo:empty -->
- Hovering a row shows the task's description as a tooltip when one is set <!-- claim:panel-todo:item-subtitle --> <!-- claim:panel-todo:row-description-tooltip -->
- A task waiting on another task shows `⊘`; once everything it waits on is done, the icon goes back to the task's own state icon <!-- claim:panel-todo:blocked-icon --> <!-- claim:panel-todo:blocked-by-badge -->

### 8.2 Subagent Segmentation

- Main agent todos appear first, without section header <!-- claim:panel-todo:main-first -->
- Subagent todos grouped under labeled sections <!-- claim:panel-todo:subagent-section -->
- Section label: uppercase Task description, truncated with ellipsis; full text in tooltip <!-- claim:panel-todo:subagent-label -->
- Falls back to truncated task ID when description unavailable <!-- claim:panel-todo:subagent-fallback -->
- Sections disappear when their Task completes <!-- claim:panel-todo:subagent-cleanup -->

### 8.3 Badge

- Icon strip shows count of incomplete todos across all subagents <!-- claim:panel-todo:badge -->
- Updates in real-time as todos change <!-- claim:panel-todo:badge-update -->

### 8.4 Other Icon-Strip Badges

- Stash icon shows count of stashed items in the default Todos style; hidden when zero <!-- claim:panel-stash:badge -->
- Tasks icon shows count of currently-running subagent Tasks in the default Todos style; hidden when none active <!-- claim:panel-task:badge -->
- MCP icon shows count of MCP servers in the `failed` state in a red (danger) variant; hidden when no failures <!-- claim:panel-mcp:badge -->

---

## 8. Help Panel

Displays keyboard shortcuts reference tables. <!-- claim:panel-help:shortcuts-table -->

---

## 9. Footer

### 10.1 DEV Mode Indicator

- In development mode, "DEV" label appears at the leftmost position of the footer <!-- claim:footer:dev-indicator -->

### 10.2 Status Indicators

| Element        | States                                                                                   |
|----------------|------------------------------------------------------------------------------------------|
| Connection dot | Green (connected), Amber (connecting/stopping), Red (error/reconnecting)                | <!-- claim:footer:connection-dot -->
| Status text    | "Ready", "Submitting...", "Working...", "Waiting...", "Stopping...", "Stopped", "Connecting", "Resuming...", "Forking...", "Creating session...", "Opening board...", "Opening workspace...", "Reconnecting...", "Disconnected", error | <!-- claim:footer:status-text -->
| Elapsed timer  | "(Ns)" suffix on Submitting/Working/Waiting, counts seconds since response started | <!-- claim:footer:elapsed-timer -->
| Interrupt hint | "Ctrl+. to stop" (when working or submitting)                                            | <!-- claim:footer:interrupt-hint -->

**Status Dot Animations:**

- Working: Color-cycling animation (blue -> purple -> magenta)
- Stopping: Amber color with pulsing glow animation
- Reconnecting: Red dot, "Reconnecting..." with animated dots; retries indefinitely until restored <!-- claim:footer:reconnecting -->

**Silence Detection:** <!-- claim:footer:silence-detection -->

- "Working..." transitions to "Waiting..." after 5 seconds without server events <!-- claim:footer:silence-threshold -->
- Waiting state dims status dot (color changes to muted gray) and text (reduced opacity, no animation) <!-- claim:footer:silence-dim -->
- Reverts to "Working..." immediately when new events arrive <!-- claim:footer:silence-recovery -->

### 10.3 Session Stats

| Stat            | Format                                    | Tooltip                        |
|-----------------|-------------------------------------------|--------------------------------|
| Workspace       | Directory name only; visible immediately on page load, before session initialization | "Workspace — /path/..." | <!-- claim:footer:workspace -->
| Turns           | Integer count                             | "Turns — N"                    | <!-- claim:footer:turns -->
| Cost            | `$X.XX` (2 decimals), defaults to `$0.00` | "API cost this session — $X.XX" | <!-- claim:footer:cost -->
| Duration        | `H:MM:SS` (updates periodically while responding) | "Time Claude spent responding — H:MM:SS" | <!-- claim:footer:duration -->
| Context         | Token count + percentage bar (max 200K); exponential color gradient blue→yellow→orange; appears only when the current runtime reports token usage | "Context — X / Y tokens" | <!-- claim:footer:context --> <!-- claim:context-usage-bar:capability-gated -->
| Runtime         | Display name of the active runtime (e.g., "Claude") | "Runtime — name"               | <!-- claim:runtime:identity-pill -->
| Model           | Model name + chevron, "—" if null; clickable to open model picker | "Model — name"                 | <!-- claim:footer:model -->
| Effort          | Effort level name + chevron; clickable to open effort picker | "Effort — level"               | <!-- claim:footer:effort -->
| Permission mode | Permission mode label + chevron; clickable to open mode picker | "Permission mode — label"      | <!-- claim:footer:permission-mode -->
| Session ID      | Full ID                                   | "Session directory — /path/..." | <!-- claim:footer:session-id -->
| Runtime ID      | 12-char prefix; "—" when no container; clicking copies the full id; transitions to "—" immediately when the container stops | "Container — full-id" | <!-- claim:footer:runtime-id -->

On a brand-new session, every footer field shows a real value from the moment the session view appears. <!-- claim:footer:new-session-populated -->

On the welcome screen (no active session), the footer shows the workspace, model, permission mode, and effort level the next session will use. The values stay visible across the welcome → new session transition. <!-- claim:footer:welcome-defaults -->

**Capability-Aware Visibility.** When the active runtime declares it does not support a footer control, the affected picker is hidden:

- Model picker is hidden when the runtime does not support switching models mid-session <!-- claim:model-picker:capability-gated -->
- Effort picker is hidden when the runtime does not support effort levels <!-- claim:effort-picker:capability-gated -->
- Permission mode picker is hidden when the runtime does not support permission modes <!-- claim:permission-mode-picker:capability-gated -->

### 10.4 Actions

| Action            | Behavior                                                    |
|-------------------|-------------------------------------------------------------|
| Click session ID  | Copies session directory path; shows "Copied!" briefly      | <!-- claim:footer:copy-session -->

### 10.5 Model Picker

Dropdown for switching the Claude model at runtime: <!-- claim:footer:model-picker -->

- Trigger: click model name in footer <!-- claim:footer:model-picker-trigger -->
- Dropdown opens upward, right-aligned to model label <!-- claim:footer:model-picker-position -->
- Lists available models with friendly name and full model ID <!-- claim:footer:model-picker-list -->
- Current model highlighted with checkmark <!-- claim:footer:model-picker-current -->
- Selecting a model updates footer immediately; takes effect on next message <!-- claim:footer:model-picker-select -->
- Closes on: selection, Escape, click outside <!-- claim:footer:model-picker-close -->
- Disabled while Claude is responding <!-- claim:footer:model-picker-disabled -->
- New sessions start with the default model, not the previous session's model <!-- claim:footer:model-picker-scope -->

### 10.6 Notifications Toggle

Toggle for sound and desktop notifications: <!-- claim:footer:notifications -->

- Position: right of session ID <!-- claim:footer:notifications-position -->
- Icon ON: Bell icon with slightly lighter color <!-- claim:footer:notifications-on -->
- Icon OFF: Bell icon with diagonal strike-through (top-left to bottom-right) <!-- claim:footer:notifications-off -->
- Controls both sound chime and desktop notifications <!-- claim:footer:notifications-scope -->
- Default: disabled (opt-in) <!-- claim:footer:notifications-default -->
- Stored per-session; survives refresh and resume <!-- claim:footer:notifications-storage -->

### 10.7 Claude Service Status

Indicator showing Claude service health from status.claude.com: <!-- claim:footer:claude-status -->

- Position: right of notifications toggle <!-- claim:footer:claude-status-position -->
- Colored dot: green (operational), yellow (minor), orange (major), red (critical), gray (error) <!-- claim:footer:claude-status-colors -->
- Tooltip shows status description; for incidents includes incident name <!-- claim:footer:claude-status-tooltip -->
- Click opens status.claude.com in new tab <!-- claim:footer:claude-status-click -->

### 10.8 Permission Mode Picker

Dropdown for switching Claude's permission mode at runtime: <!-- claim:footer:permission-mode-picker -->

- Trigger: click mode label in footer <!-- claim:footer:permission-mode-picker-trigger -->
- Dropdown opens upward, aligned to mode label <!-- claim:footer:permission-mode-picker-position -->
- Lists every permission mode the underlying agent recognises with friendly labels: Default (standard behavior), Plan (planning mode), Accept Edits (auto-accept file edits), Bypass (bypass permission checks), Don't Ask (allow all tools without prompting), Auto (automatically determine mode) <!-- claim:footer:permission-mode-picker-list -->
- Current mode highlighted with checkmark <!-- claim:footer:permission-mode-picker-current -->
- Selecting a mode updates footer immediately; takes effect on next action <!-- claim:footer:permission-mode-picker-select -->
- Closes on: selection, Escape, click outside <!-- claim:footer:permission-mode-picker-close -->
- Disabled while Claude is responding <!-- claim:footer:permission-mode-picker-disabled -->
- New sessions start with full permissions (default) <!-- claim:footer:permission-mode-picker-default -->

### 10.9 Effort Level Picker

Dropdown for switching Claude's reasoning effort level at runtime: <!-- claim:footer:effort-picker -->

- Trigger: click effort label in footer <!-- claim:footer:effort-picker-trigger -->
- Position: between model picker and permission mode picker <!-- claim:footer:effort-picker-position -->
- Dropdown opens upward, aligned to effort label <!-- claim:footer:effort-picker-dropdown -->
- Lists available effort levels with friendly labels <!-- claim:footer:effort-picker-list -->
- Current level highlighted with checkmark <!-- claim:footer:effort-picker-current -->
- Selecting a level updates footer immediately <!-- claim:footer:effort-picker-select -->
- Closes on: selection, Escape, click outside <!-- claim:footer:effort-picker-close -->
- Disabled while Claude is responding <!-- claim:footer:effort-picker-disabled -->
- Default effort level: "xhigh" <!-- claim:footer:effort-picker-default -->
- All effort levels available on all models <!-- claim:footer:effort-picker-all-models -->
- Effort level persisted in session; survives refresh and resume <!-- claim:footer:effort-picker-persist -->

---

## 10. Error Handling

### 11.1 Error Display

| Error Type | Display                            |
|------------|------------------------------------|
| API error  | Footer transient message (4s)      | <!-- claim:error:api -->
| Connection error | Connection status + auto-reconnect | <!-- claim:error:sse -->
| Turn error | Red border on turn                 | <!-- claim:error:turn -->
| Tool error | Error styling in tool block        | <!-- claim:error:tool -->
| Interrupt  | Yellow border on interrupted turn  | <!-- claim:error:interrupt -->


**Interrupt Visualization:** <!-- claim:chat:interrupt-visual -->

- User interrupts (Ctrl+. or stop button) show visual indication <!-- claim:chat:interrupt-border -->
- Interrupted turn shows yellow left border <!-- claim:chat:interrupt-range -->
- Internal interrupt confirmation not shown as user bubble <!-- claim:chat:interrupt-ack-hidden -->

### 11.2 Recovery

- Network errors trigger automatic reconnection <!-- claim:error:auto-reconnect -->
- Intentional session close transitions cleanly to disconnected state <!-- claim:error:graceful-disconnect -->
- User can manually reconnect via reload button <!-- claim:error:manual-reconnect -->
- Session state preserved across reconnects <!-- claim:error:preserve-state -->
- Error state auto-clears after 4 seconds <!-- claim:error:state-clear -->
- "Stopped" state clears automatically after a short delay once the result event arrives <!-- claim:error:state-stopped-clear -->
- All live panels show "Resuming..." during replay <!-- claim:error:resuming-panels -->
- Session automatically recovers after a service restart; shows "Session reconnect failed" on failure <!-- claim:error:daemon-restart-recovery -->

---

## 11. Performance Requirements

### 12.1 Responsiveness

| Action                | Expectation           |
|-----------------------|-----------------------|
| Keystroke in textarea | Immediate             |
| Panel toggle          | Instant feedback      |
| New message display   | Near-instant          |
| Scroll                | Smooth, no jank       |

---

## 12. Notifications

### 13.1 Desktop Notifications

Browser notification when response completes: <!-- claim:notify:desktop -->

- Trigger: response completes AND tab not visible AND notifications enabled <!-- claim:notify:desktop-trigger -->
- Title: matches browser tab title <!-- claim:notify:desktop-title -->
- Body: first ~50 chars of assistant message (not thinking block) <!-- claim:notify:desktop-body -->
- Click action: focus claudebox tab <!-- claim:notify:desktop-click -->
- Requires browser permission <!-- claim:notify:desktop-permission -->
- Do NOT notify on session resume <!-- claim:notify:desktop-no-resume -->

### 13.2 Sound Alerts

Audio notification on completion: <!-- claim:notify:sound -->

- Trigger: on completion AND tab not visible AND sound enabled <!-- claim:notify:sound-trigger -->
- Sound: single chime (same for success/error) <!-- claim:notify:sound-type -->
- Volume: quiet (not full volume) <!-- claim:notify:sound-volume -->
- Default: disabled (opt-in via footer toggle) <!-- claim:notify:sound-default -->

### 13.3 Favicon Indicator

Visual indicator when tab not focused: <!-- claim:notify:favicon -->

- Show breathing arc animation while Claude is responding <!-- claim:notify:favicon-processing -->
- Change to notification variant when response completes <!-- claim:notify:favicon-change -->
- Restore normal favicon on tab focus <!-- claim:notify:favicon-restore -->
- Circular background tinted in the workspace accent color fills the favicon (inscribed inside a small transparent margin) when a workspace color is set; the C-shape appears in white on top <!-- claim:notify:favicon-workspace-badge -->
- Badge fills the favicon as a centered circle inscribed inside a small transparent margin <!-- skip:claim:notify:favicon-workspace-badge-shape -->
- Badge fill color is a brightened version of the workspace accent color <!-- claim:notify:favicon-workspace-badge-color -->
- No badge appears when no workspace color is set <!-- claim:notify:favicon-workspace-badge-absent -->
- Badge background appears at reduced opacity while the notification state is active; the C-shape stays at full opacity <!-- claim:notify:favicon-workspace-badge-notification-dimmed -->
- Badge background pulses in opacity in sync with the C-shape's breathing animation while Claude is responding <!-- skip:claim:notify:favicon-workspace-badge-processing-pulse animation timing -->

### 13.4 Tab Title Indicator

Visual indicator in browser tab: <!-- claim:notify:tab-indicator -->

- Prepend `* ` to tab title when Claude finishes and user hasn't interacted <!-- claim:notify:tab-indicator-prefix -->
- Clear prefix on any user interaction (click, typing) or window focus <!-- claim:notify:tab-indicator-clear -->

---

## 13. MCP Status Panel

### 14.1 Panel Content

- List of MCP servers with status indicators <!-- claim:panel-mcp:list -->
- Status dot colors: green (connected), red (disconnected/failed), amber (pending/needs-auth), muted gray (disabled) <!-- claim:panel-mcp:status-indicators -->
- Non-connected, non-disabled servers show status text label; dot tooltip shows status <!-- claim:panel-mcp:disconnected-info -->
- Empty state: "No MCP servers connected" <!-- claim:panel-mcp:empty -->
- The MCP panel only appears when the current runtime exposes MCP server control <!-- claim:mcp-panel:capability-gated -->

### 14.2 Server Management

- Reconnect button (refresh icon) shown for disconnected/failed servers <!-- claim:panel-mcp:reconnect-btn -->
- Enable/Disable toggle button shown for all servers <!-- claim:panel-mcp:toggle-btn -->
- Disabled servers show green-bordered "Enable" button; connected servers show "Disable" button <!-- claim:panel-mcp:toggle-labels -->
- Buttons disabled while an action is in progress; reconnect icon spins during loading <!-- claim:panel-mcp:loading-state -->
- After successful action, panel refreshes to show updated server status <!-- claim:panel-mcp:status-update -->
- Error message shown at top of panel on action failure; auto-clears after 4 seconds <!-- claim:panel-mcp:error-display -->

---

## 14. Bookmarks

### 14.1 Bookmark Toggle

- Bookmark button shown on user message rows (between rewind and copy buttons); on assistant turns, bookmark button is persistently visible in the turn's meta area alongside the copy button <!-- claim:bookmark:toggle-btn -->
- User-turn bookmark hidden by default, visible on hover; assistant-turn bookmark always visible; filled yellow when active, outline when inactive <!-- claim:bookmark:toggle-visibility -->
- Clicking toggles bookmark state; survives refresh and resume <!-- claim:bookmark:persistence -->

### 14.2 Minimap Indicators

- Bookmarked turns display as fully highlighted yellow sub-bar segments in minimap <!-- claim:bookmark:minimap-segment -->

### 14.3 Bookmarks Panel

- Side panel on right strip below Tasks and above Boards, accessible via Alt+5 <!-- claim:panel-bookmarks:shortcut -->
- Two tabs: "This session" and "All sessions", with count badges <!-- claim:panel-bookmarks:tabs -->
- Active tab tracks active-session presence: "This session" while a session is open, "All sessions" while none is. Manual clicks override; the next session-state change re-asserts the auto-mapping (auto-switch wins) <!-- claim:panel-bookmarks:tab-auto-switch -->
- "This session" tab lists bookmarks in current session; clicking scrolls to the bookmarked turn <!-- claim:panel-bookmarks:session-scroll -->
- "All sessions" tab lists bookmarks from all sessions, sorted by recency; clicking navigates to the session; visible without an active session <!-- claim:panel-bookmarks:all-sessions -->
- Loading state on cold load: panel-level italic muted "Loading..." placeholder; tabs and list appear only after first load <!-- claim:panel-bookmarks:loading -->
- Empty state on both tabs: centered, italic, muted "No bookmarks" <!-- claim:panel-bookmarks:empty -->
- Each bookmark shows preview text (first 80 chars), relative timestamp, and a colored container-status dot reflecting the source session's state (green/amber/gray) <!-- claim:panel-bookmarks:preview --> <!-- claim:panel-bookmarks:status-dot -->
- Hovering a truncated preview reveals the full text in a native tooltip <!-- claim:panel-bookmarks:tooltip -->
- Remove button anchored to the top-right corner of each item, visible on hover <!-- claim:panel-bookmarks:remove -->
- Middle-click or Alt+click opens the bookmarked session in a new browser tab; the originating item flashes briefly to confirm the action <!-- claim:panel-bookmarks:new-tab -->

### 14.4 Cross-Tab Sync

- Bookmark changes sync across browser tabs <!-- claim:bookmark:cross-tab -->

---

## 15. Tasks Panel

### 15.1 Purpose

Panel for monitoring background tasks: <!-- claim:panel-task:panel -->

- Filter tabs: "Active" (running only) and "All" (including completed/failed/killed); badge counts per filter <!-- claim:panel-task:filter-tabs -->
- Tasks sorted chronologically (oldest first) <!-- claim:panel-task:sort-chronological -->
- Click task focuses chat tab, then scrolls to the top of the visible area with a brief highlight pulse <!-- claim:panel-task:click-tab -->
- Empty state: "No tasks" <!-- claim:panel-task:empty -->
- Resume state: "Resuming..." <!-- claim:panel-task:resume -->

### 15.2 Task Item Display

| Element | Content |
|---------|---------|
| Status indicator | Running/completed/failed colored left border; "killed" displayed as "failed" | <!-- claim:panel-task:status-indicator -->
| Description | Task description from invocation | <!-- claim:panel-task:description -->
| Duration | Time since start (live for running) | <!-- claim:panel-task:duration -->

### 15.3 Staleness Indication

Running tasks show staleness via left border color gradient: <!-- claim:panel-task:staleness -->

- Fresh (≤15s since last event): blue <!-- claim:panel-task:staleness-fresh -->
- Transitioning (15–90s): blue → purple → amber gradient <!-- skip:claim:panel-task:staleness-gradient -->
- Stale (>90s): amber fading toward gray <!-- skip:claim:panel-task:staleness-faded -->
- New event resets color to fresh immediately <!-- skip:claim:panel-task:staleness-reset -->
- Only running tasks show staleness coloring; completed tasks use static status colors <!-- claim:panel-task:staleness-running-only -->

---

## 16. Usage Panel

### 16.1 Panel Content

Aggregated cost display over time intervals: <!-- claim:panel-usage:content -->

| Interval | Description |
|----------|-------------|
| 24 hours | Cost from sessions started within 24 hours | <!-- claim:panel-usage:24h -->
| 7 days | Cost from sessions started within 7 days | <!-- claim:panel-usage:7d -->
| 30 days | Cost from sessions started within 30 days | <!-- claim:panel-usage:30d -->
| All time | Total cost across all sessions | <!-- claim:panel-usage:all -->

- Cost formatted as `$X.XX` <!-- claim:panel-usage:format -->
- Zero cost shows `$0.00` <!-- claim:panel-usage:zero -->
- Refreshes when sessions change <!-- claim:panel-usage:update -->

---

## 17. Logs Panel

### 17.1 Panel Content

Real-time log viewer:

- Entry format: timestamp, log level, logger name, message <!-- claim:panel-log:format -->
- Log levels color-coded (debug, info, warning, error, critical) <!-- claim:panel-log:colors -->
- Auto-scroll to latest; respects user scroll position <!-- claim:panel-log:autoscroll -->
- No container: "No active session" <!-- claim:panel-log:no-container -->
- Loading state: "Loading logs..." <!-- claim:panel-log:loading -->
- Connecting state: "Connecting..." <!-- claim:panel-log:connecting -->
- Empty state: "No logs yet" <!-- claim:panel-log:empty -->
- Resume state: "Resuming..." <!-- claim:panel-log:resume -->

---

## 18. Commands Panel

### 18.1 Panel Content

Displays available slash commands organized by category:

- Three tabs: Custom (default), MCP, All <!-- claim:panel-command:tabs -->
- MCP tab: commands starting with `mcp__` <!-- claim:panel-command:mcp-filter -->
- Custom tab: all other commands <!-- claim:panel-command:custom-filter -->
- All tab: all commands unfiltered <!-- claim:panel-command:all-filter -->
- Tab badges show count per category <!-- claim:panel-command:tab-counts -->
- Commands displayed with `/` prefix (e.g., `/deploy`) <!-- claim:panel-command:slash-prefix -->
- Empty state: "No commands" <!-- claim:panel-command:empty -->
- Resume state: "Resuming..." <!-- claim:panel-command:resume -->

---

## 19. Workspaces & Containers

### 19.1 Workspace Discovery

- Available workspaces appear on page load <!-- claim:workspace:discovery -->
- Single workspace: auto-selected; no workspace-list dropdown shown (color palette still appears in chat group; see §19.2) <!-- claim:workspace:auto-select -->
- Multiple workspaces: selection priority is URL hash > saved preference > first workspace <!-- claim:workspace:selection-priority -->

### 19.2 Workspace Switcher

- Dropdown in the chat-area header tab bar (right-aligned) <!-- claim:workspace:switcher -->
- Shows current workspace name with chevron <!-- claim:workspace:switcher-label -->
- Always visible in chat group; shows color palette for single workspace, workspace list + palette for multiple <!-- claim:workspace:switcher-visibility -->
- Dropdown lists all workspaces with path; checkmark on active <!-- claim:workspace:switcher-list -->
- External link icon per workspace: opens workspace in new browser tab <!-- claim:workspace:switcher-new-tab -->
- Middle-click on workspace item opens it in a new browser tab <!-- claim:workspace:switcher-middle-click -->
- Switching workspaces clears session data and stash <!-- claim:workspace:switcher-reset -->
- Each workspace row has a trash icon (revealed on hover) — clicking it opens a confirm modal that deregisters the workspace on confirm <!-- claim:workspace:deregister -->
- Deregistering preserves the `.workspace` marker file on disk; only the workspace's registration with Claudebox is removed <!-- claim:workspace:deregister-preserves-marker -->
- A "+ Register workspace…" footer item below the color palette opens a modal that accepts an absolute path and registers it <!-- claim:workspace:register -->
- Registering an already-known path is idempotent: the modal shows an inline notice and auto-closes; no duplicate workspace row is created <!-- claim:workspace:register-idempotent -->

### 19.3 Deep Linking

- URL form: `#/workspaces/{workspaceId}/sessions/{sessionId}` <!-- claim:workspace:url-routing -->
- Supports deep linking and browser back/forward navigation <!-- claim:workspace:url-deep-link -->
- Deep link to session in different workspace triggers automatic workspace switch <!-- claim:workspace:url-cross-workspace -->
- URL updates on session switch, workspace switch, and new session creation <!-- claim:workspace:url-update -->

### 19.4 Container Status Indicators

- Colored dot on the session header strip: green (running), amber (stopping), gray (no container) <!-- claim:container:tab-dot -->
- Colored dot on session panel rows: same colors and states <!-- claim:container:panel-dot -->
- Dot color mapping: running (green), stopping (amber), all other states (gray) <!-- claim:container:dot-states -->
- Stopping a session shows the stopping color on every status dot at once; once the container is gone, all dots clear together — no dot stays showing stopping, and none keeps showing running <!-- claim:container:stop-clears-uniformly -->

### 19.5 Session Creation Overlay

When creating a new session: <!-- claim:container:creation-overlay -->

| Feature | Behavior |
|---------|----------|
| Header strip indicator | Session name slot shows "Creating…" with a spinner | <!-- claim:container:provisional-tab -->
| Progress bar | Indeterminate (no percentage) | <!-- claim:container:creation-progress -->
| Status text | "Creating session...", "Starting session..." | <!-- claim:container:creation-status -->
| Textarea | Visible and editable; submitted messages queued and auto-sent when session is ready | <!-- claim:container:creation-textarea -->
| Submitted messages | Appear in the chat history as regular pending and queued user messages — same shape and width as during a normal chat | <!-- claim:container:creation-messages-inline -->
| On success | Header strip swaps "Creating…" for the session name; overlay dismissed | <!-- claim:container:creation-success -->
| On failure | Header strip clears the "Creating…" placeholder; error shown | <!-- claim:container:creation-failure -->

### 19.7 Session Resume Overlay

When resuming an existing session: <!-- claim:container:resume-overlay -->

| Feature | Behavior |
|---------|----------|
| Progress bar | Determinate (fills as events replay) | <!-- claim:container:resume-progress -->
| Phase 1 | "Starting session...", "Resuming session..." | <!-- claim:container:resume-daemon-phase -->
| Phase 2 | Replay progress: "Replaying events (X/Y)..." | <!-- claim:container:resume-replay-phase -->
| Textarea | Stays usable and focused during resume; Enter queues the typed message, which auto-sends as soon as replay completes | <!-- claim:container:resume-textarea-stays-enabled -->

### 19.7.5 Containers Panel

A bottom-slot panel listing every container the app knows about, across all registered workspaces. Mounted at the bottom-left slot of the bottom-panel strip.

- Each row shows: a colored state dot, the container's 12-character identifier (the same one shown in the footer when the active session is attached to that container), the 8-character session identifier (matching the Sessions panel), the session name, the capitalized state name (Running / Starting / Stopping / Crashed / Stopped), the capitalized kind label, and the relative age <!-- claim:panel-containers:columns --> <!-- claim:panel-containers:id-source -->
- Hovering the container identifier shows a tooltip reading `Container — <full identifier>` (the same string the footer's container pill shows) <!-- claim:panel-containers:id-tooltip-format -->
- Hovering the session identifier shows a tooltip reading `Session directory — <full path>` (the same string the Sessions panel and the footer show on the session identifier) <!-- claim:panel-containers:session-id-tooltip-format -->
- Clicking the container identifier copies the full identifier to the clipboard; a brief "Copied!" indicator appears in the same slot and reverts after a short interval <!-- claim:panel-containers:id-copy-on-click -->
- Clicking the session identifier copies the session directory path to the clipboard; a brief "Copied!" indicator appears in the same slot and reverts after a short interval <!-- claim:panel-containers:session-id-copy-on-click -->
- Columns line up vertically across all rows <!-- claim:panel-containers:row-grid -->
- The container and session identifiers appear in a small monospace font <!-- claim:panel-containers:id-typography -->
- When the attached session has no custom name, the session-name cell is empty <!-- claim:panel-containers:session-name-empty -->
- Row text and icons share a common vertical baseline <!-- claim:panel-containers:row-baseline -->
- Containers for the current workspace appear in the list — switching workspaces refreshes the panel to show that workspace's containers <!-- claim:panel-containers:list -->
- Rows are sorted by state group (running → starting → stopping → crashed → stopped); within each group, newer containers appear first <!-- claim:panel-containers:sort -->
- Rows update without manual refresh as containers start, transition state, or stop <!-- claim:panel-containers:live-updates -->
- A "Stop" button on each running or starting row stops and removes the container (matches the sessions-panel and main-header stop affordance) <!-- claim:panel-containers:stop -->
- Rows with an attached session show a Play+chevron resume control: clicking Play opens the session in the current tab; Alt-click or middle-click opens in a new browser tab; the chevron opens a dropdown with both options explicit. The resume control is not shown on the current container's row (the session you are already viewing). <!-- claim:panel-containers:open-session -->
- The current container's row is highlighted with an accent-colored left border and a darker background, matching how the active session is highlighted in the Sessions panel <!-- claim:panel-containers:current-highlight -->
- The Resume control is not shown on the current container's row <!-- claim:panel-containers:current-no-resume -->
- Empty state: "No containers" <!-- claim:panel-containers:empty -->

### 19.8 Welcome State

- When no session is active, chat panel shows welcome page <!-- claim:container:welcome-state -->
- Workspace name displayed prominently; colored with workspace accent if set, otherwise default text color <!-- claim:container:welcome-name -->
- Workspace path displayed below name (muted) <!-- claim:container:welcome-path -->
- Chat input anchored to the bottom of the chat panel, visually indistinguishable from the active-session input (full panel width, same surrounding controls); submitting Enter creates a new session and sends the typed message as its first message <!-- claim:container:welcome-input -->
- Picker changes (model, permission mode, effort level) made on the welcome screen apply to the next session created from that welcome view; only the latest value per picker is applied; pickers display the chosen values immediately <!-- claim:input:welcome-config-buffer -->
- Keyboard shortcuts reference card listing key bindings (Alt+N, Alt+Shift+N, Alt+arrows, Alt+C, Alt+1..9, Alt+?) <!-- claim:container:welcome-shortcuts -->

---

## 20. Mobile

A single-column layout for narrow screens: top bar, status strip, chat area only. No side panels, icon strips, or tab bar.

### 20.1 Activation

- On touch-primary devices (phones and tablets), the app shows the mobile layout instead of the desktop layout <!-- claim:mobile:activation -->
- Layout classification depends on device type, not browser window size <!-- claim:mobile:viewport-change -->

### 20.2 Layout Structure

Top to bottom: top bar, status strip, chat area. The drawer slides in from the left and the details sheet drops down from below the top bar — both appear over the chat area when opened. <!-- claim:mobile:layout-structure -->

### 20.3 Top Bar

| Element | Behavior |
|---------|----------|
| Hamburger (left) | Tapping opens the navigation drawer | <!-- claim:mobile:top-hamburger -->
| Session name (center) | Shows the active session name | <!-- claim:mobile:top-session-name -->
| Session name fallback | Shows "claudebox" when there is no session name | <!-- claim:mobile:top-session-name-default -->
| Stop affordance | The chat send button doubles as the stop control on mobile | <!-- claim:mobile:send-button-stop -->
| Details button (right) | Tapping toggles the details sheet open and closed | <!-- claim:mobile:top-details-toggle -->

### 20.4 Status Strip

A thin, non-interactive bar below the top bar.

- Connection dot is green when connected <!-- claim:mobile:status-connected -->
- Connection dot is gray when disconnected <!-- claim:mobile:status-disconnected -->
- Context usage percentage is displayed next to a fill bar that grows with usage <!-- claim:mobile:status-context-pct -->
- Percentage display caps at 100% even when context is exceeded <!-- claim:mobile:status-context-cap -->
- Fill bar color shifts with usage level (e.g. green → amber → red as usage rises) <!-- claim:mobile:status-context-color -->

### 20.5 Navigation Drawer

Slides in from the left when the hamburger is tapped.

- Tapping the X close button at the top-left closes the drawer <!-- claim:mobile:drawer-dismiss -->
- The drawer covers the full screen when open <!-- claim:mobile:drawer-fullscreen -->
- Workspace switcher is hidden when only one workspace is registered <!-- claim:mobile:drawer-workspaces-single -->
- Workspace switcher lists all workspaces when more than one is registered; tapping a workspace switches to it and closes the drawer <!-- claim:mobile:drawer-workspaces-multi -->
- New session button starts a new session and closes the drawer <!-- claim:mobile:drawer-new-session -->
- Session list shows every session for the active workspace <!-- claim:mobile:drawer-session-list -->
- Tapping a session row switches to that session and closes the drawer <!-- claim:mobile:drawer-session-switch -->
- Sessions without a name fall back to a short prefix of their identifier as the label <!-- claim:mobile:drawer-session-fallback -->
- Close session button stops the active session <!-- claim:mobile:drawer-close-session -->
- Close session button is disabled when there is no active session or the app is disconnected <!-- claim:mobile:drawer-close-disabled -->

### 20.6 Details Sheet

Drops down from below the top bar when the details button is tapped.

- Tapping outside the sheet closes it <!-- claim:mobile:details-dismiss -->
- Shows: connection status, workspace name, turn count, total cost (two decimals, USD), elapsed duration, context usage percentage, model, effort level, and permission mode <!-- claim:mobile:details-fields -->
- The sheet's background is visually distinct from the chat behind it <!-- claim:mobile:details-sheet-bg -->

### 20.7 Chat Area

- The welcome screen leads with a touch-suited usage prompt <!-- claim:mobile:welcome-touch -->
- Chat occupies the full content width <!-- claim:mobile:chat-fullwidth -->
- The send button doubles as a stop button while a response is in flight; tapping it interrupts the response <!-- claim:mobile:send-button-morph -->
- Tapping the chat input keeps the page at its current zoom level <!-- claim:mobile:no-zoom -->

### 20.8 Drawer Session Rows

- Each drawer session row shows a status dot, ID prefix, optional name, an edit pencil, started→updated timestamps, turns, cost, and first/last message previews — matching the desktop session item content <!-- claim:mobile:session-list-rich -->
- Tapping anywhere on a non-current session row resumes that session in the current browser tab and closes the drawer <!-- claim:mobile:session-list-tap-resume -->

---

## 21. CLI

The host-side `claudebox` binary is a verb-mode command line: `claudebox <verb> [options] [-- agent-args]`. Each verb is a discrete subcommand with its own help and options.

### 21.1 Run

Running `claudebox run` launches an agent session in a fresh container:

- The agent's exit code is the command's exit code <!-- claim:cli:run -->
- Arguments after `--` are forwarded to the agent <!-- claim:cli:run:args-passthrough -->
- If no `.workspace` marker is found by walking up from the current directory, the current directory is used as the workspace; no error, no prompt <!-- claim:cli:run:workspace-fallback -->
- `run` operates without registering the workspace; the session works in cwd-as-workspace fallback mode <!-- claim:cli:run:no-auto-register -->

### 21.2 Build

Running `claudebox build` produces a container image:

- Running `build` produces a usable image; no agent session is started <!-- claim:cli:build -->
- `--layer all` rebuilds the entire image; `--layer agent` rebuilds only the agent layer <!-- claim:cli:build:layer -->
- When the build fails, the command exits with the same code the build tool would have <!-- claim:cli:build:failure-propagated -->

> The `build` verb operates on the container image; `update` operates on Claudebox itself (Claudebox's library on the host). They are unrelated despite both being able to refresh "the agent" — `build` rebuilds the agent layer in the image; `update` refreshes Claudebox's own installed code.

### 21.3 Shell

Running `claudebox shell` opens a fresh container with a bash prompt <!-- claim:cli:shell -->

### 21.4 Prune

Running `claudebox prune` removes accumulated resources:

- Running `prune` removes stale temp directories, dangling claudebox images, and stopped claudebox containers (typically none under auto-removal) <!-- claim:cli:prune -->
- If a removal fails, the rest still run; the command exits non-zero <!-- claim:cli:prune:partial-failure -->

### 21.5 Version

Running `claudebox version` prints a multi-line block: the package version, the branch and short commit of the installed library, the install path, and the Python and container-runtime versions <!-- claim:cli:version -->

### 21.6 Doctor

Running `claudebox doctor` runs an ordered set of environment checks and prints a result row per check; the command exits non-zero if any check failed <!-- claim:cli:doctor -->

### 21.7 Update

Running `claudebox update` refreshes Claudebox itself:

- Running `update` refreshes Claudebox; verbose output is forwarded when `-v` is passed <!-- claim:cli:update -->
- Running `update` twice in parallel: the second invocation fails immediately with a clear message <!-- claim:cli:update:concurrent-blocked -->

### 21.8 Daemon

Running `claudebox daemon start`, `stop`, `restart`, or `status` controls the host daemon <!-- claim:cli:daemon -->

### 21.9 Logs

Running `claudebox logs` tails the daemon log:

- Running `logs` shows the most recent daemon output and continues following it <!-- claim:cli:logs -->
- Errors appear red, warnings yellow, regular lines default <!-- claim:cli:logs-colorization -->
- Running `logs all` interleaves daemon and container output; every line is prefixed with its source <!-- claim:cli:logs-all -->

### 21.10 Status

Running `claudebox status` shows daemon, container, and workspace state:

- Running `status` shows daemon, container, and workspace state in three sections <!-- claim:cli:status -->
- When the daemon is stopped, status still shows container and workspace info; the daemon section reports its stopped state <!-- claim:cli:status-degraded -->

### 21.11 Containers

Running `claudebox containers list`, `stop`, or `kill` manages containers across all workspaces:

- The table lists every container across every workspace <!-- claim:cli:containers-list -->
- Stop signals the container gracefully; the container exits and disappears from the list; supports a single ID or `all` <!-- claim:cli:containers-stop -->
- Kill signals the container forcefully; the container exits and disappears from the list; supports a single ID or `all` <!-- claim:cli:containers-kill -->
- You can pass any unique prefix of a container ID; ambiguous prefixes show matching IDs <!-- claim:cli:containers-prefix-match -->
- When stopping or killing multiple containers, each is reported individually; failures don't abort the rest; the command exits non-zero if any failed <!-- claim:cli:containers-partial-failure -->

### 21.12 Workspaces

Running `claudebox workspaces list`, `register`, or `deregister` manages the daemon's workspace registry:

- Running `workspaces list` shows every registered workspace <!-- claim:cli:workspaces-list -->
- Running `workspaces register` registers the current directory (or the given path) as a workspace and creates the `.workspace` marker if absent <!-- claim:cli:workspaces-register -->
- Registering an already-registered workspace succeeds and reports it was already registered <!-- claim:cli:workspaces-register-idempotent -->
- Two paths sharing a basename get distinct workspace IDs <!-- claim:cli:workspaces-register-collision -->
- Running `workspaces deregister <id>` removes the workspace from the registry; the `.workspace` marker file is preserved <!-- claim:cli:workspaces-deregister -->
