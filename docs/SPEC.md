# Claudebox Specification

> **Purpose**: This document describes user-facing behavior only—what the user sees and experiences. It is not concerned with implementation details, architecture, or code structure.

## Overview

Claudebox is a containerized development environment for AI coding agents. The web UI provides:

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
│              │   │                     │   │    Crons       │
│              │   └─────────────────────┘   │    Bookmarks   │
│              │                             │    Boards      │
│              │                             │    Usage       │
│              │                             │    MCP         │
│              │                             │    Skills      │
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

- **Left strip**: Sessions (top); Containers sits at the bottom of the left strip <!-- claim:layout:left-strip -->
- **Right strip**: Todos, Stash, Tasks, Crons, Bookmarks, Boards, Usage, MCP, Skills, Help (top to bottom); Logs sits at the bottom of the right strip <!-- claim:layout:right-strip -->
- The Logs icon lives at the bottom of the right strip <!-- claim:layout:logs-right-bottom -->
- Icons show badge counts for Todos (incomplete), Stash (item count), Tasks (running), Crons (active schedules) and MCP (failed servers) - see §8.3, §8.4 and §17 <!-- claim:layout:badges -->
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
- Each side panel's tab shows the panel's icon-strip icon before its title <!-- claim:layout:panel-tab-icon -->
- Skills, Tasks, and Containers panel rows share a padded-card look with a subtle background, brighter on hover, and consistent vertical spacing. Identifier values are monospaced; other text uses the regular font. <!-- claim:layout:panel-row-card -->
- Hovering an icon while panels are maximized opens that panel as a floating overlay anchored to the icon, after a short hover-intent delay. The overlay grows to fit its content and stays within the icon strip's vertical bounds <!-- claim:layout:floating-panel -->
- Logs and Containers floating previews open wider than other panels to fit their horizontally-dense rows <!-- claim:layout:floating-panel-wide-panels -->
- When no panels are maximized, hovering an icon for a panel that is not currently visible (a closed side panel, or the closed logs strip) opens its floating preview after a short hover-intent delay <!-- claim:layout:floating-panel-inactive -->

### 1.4 Canonical Panel Order

Panels maintain consistent vertical stacking within each side: <!-- claim:layout:panel-order-stack -->

- **Left**: Sessions (top), Containers (bottom) <!-- claim:layout:panel-order-left -->
- **Right**: Todos (top), Stash, Tasks, Crons, Bookmarks, Boards, Usage, MCP, Skills, Help (bottom) <!-- claim:layout:panel-order-right -->

Opening a panel inserts it at correct position relative to visible panels. <!-- claim:layout:panel-order-insert -->

### 1.5 Layout Persistence

- Layout saved automatically on every change <!-- claim:layout:save -->
- Includes panel configuration and widths <!-- claim:layout:save-content -->
- Restored on page load; falls back to default if unavailable <!-- claim:layout:restore -->
- New sessions inherit panel layout from most recent session <!-- claim:layout:auto-copy -->
- The bottom strip's open panels and height are part of the layout: moving between sessions leaves them as they are, a change made just before moving is kept, and a reload restores them with the rest of the layout <!-- claim:layout:bottom-panels-follow-layout -->

### 1.6 Default Layout

- Main panel in center, default content is the welcome view (chat content appears once a session is opened) <!-- claim:layout:default-chat-center -->
- Sessions panel opens on left <!-- claim:layout:default-left-panels -->
- Todos, Stash, Tasks, Crons, Bookmarks, Boards panels open on right; Usage and MCP remain hidden by default <!-- claim:layout:default-right-panels -->

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
| `#/workspaces/{id}/sessions/{sessionId}/turns/a-{turnId}/{part}` | Active session; paused at one bookmarked paragraph or tool call in turn `{turnId}` | <!-- claim:url:session-turn-part -->
| `#/workspaces/{id}/boards/{boardId}`                     | Active board                                                   | <!-- claim:url:board -->

A workspace-only URL may also carry one or more messages, opening a new session and submitting them as its first turns: <!-- claim:url:link-new-session -->

- Repeated carried text submits in the order it appears in the URL <!-- claim:url:link-send-order -->
- Text submits automatically only when it matches a pattern the workspace's settings approve; if any piece of carried text does not match, none of it submits <!-- claim:url:link-allowlist -->
- Carried text spanning several lines is matched as a whole, and a pattern's wildcard matches across its line breaks <!-- claim:url:link-allowlist-multiline -->
- Text that does not submit waits in the message box instead, with a notice explaining why <!-- claim:url:link-blocked-to-input -->
- The carried text is used once — reloading the page the link produced reopens the same session without submitting anything again <!-- claim:url:link-consumed-once -->
- A link naming a workspace that is not registered opens no session and submits nothing <!-- claim:url:link-unregistered-workspace -->

- Hash auto-updates as the user scrolls: gains `/turns/<role>-<id>` segment when autoscroll disengages; loses the segment when the user scrolls back to bottom and autoscroll re-engages <!-- claim:url:scroll-sync -->
- Hash updates apply to all scroll causes — user scroll, programmatic jump (bookmark click, scroll-to-edge), autoscroll re-engage <!-- claim:url:scroll-sync-all-causes -->
- Hash updates do not add entries to browser back/forward history <!-- claim:url:scroll-sync-history-clean -->
- On reload, the URL form is honored: bare URL → scroll to bottom and autoscroll engaged; turn URL → scroll to that turn and autoscroll disengaged <!-- claim:url:reload-restore -->
- Bookmarks and other cross-session navigation produce URLs with the appropriate `/turns/<role>-<id>` segment so deep-links and Alt+click-to-new-browser-tab land on the targeted message <!-- claim:url:cross-session-deep-link -->
- The hash names the session currently in focus; the sessions it descended from appear alongside it without appearing in the URL <!-- claim:url:hash-names-focused-session -->

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
| Alt+9    | Toggle Skills    | <!-- claim:shortcut:alt9 -->
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
- Ctrl+Z undoes any editing shortcut in one step - tag wrap, indent and dedent, smart newline, auto-pairing, collapse and expand - restoring the text and selection from before it; Ctrl+Shift+Z redoes it, and a block collapsed or expanded again by undo or redo still expands and collapses <!-- claim:input:editing-keys-undo -->
- Collapsed blocks display as `<tag...N>` placeholder in textarea text (N is a sequence number) <!-- claim:input:collapse-placeholder -->
- Collapse targets innermost enclosing block; repeated Ctrl+' collapses next outer <!-- claim:input:collapse-nested -->
- Collapsed blocks auto-expand before submit (full content sent to server) <!-- claim:input:collapse-auto-expand -->
- Chat input shortcuts require chat panel focus (except Alt navigation shortcuts, which are global) <!-- claim:shortcut:focus-required -->

### 2.3 Chat Navigation

Alt+Up/Down/Home/End below act on the chat transcript specifically:

| Shortcut | Action |
|----------|--------|
| Alt+Up   | Jump to previous human message | <!-- claim:shortcut:alt-up -->
| Alt+Down | Jump to next human message | <!-- claim:shortcut:alt-down -->
| Alt+Home | Jump to first message (top of chat) | <!-- claim:shortcut:alt-home -->
| Alt+End  | Jump to last message (bottom of chat) | <!-- claim:shortcut:alt-end -->

Alt+PageUp/PageDown belong to whichever view occupies the right split slot - the terminal or the work column:

| Shortcut | Action |
|----------|--------|
| Alt+PageUp   | Step the right-hand column to the nearest entry above the visible area | <!-- claim:shortcut:alt-pageup -->
| Alt+PageDown | Step the right-hand column to the next entry below the visible area | <!-- claim:shortcut:alt-pagedown -->

Alt+Shift+Left/Right move focus one group along the session rail (§3.19), clamping at both ends:

| Shortcut | Action |
|----------|--------|
| Alt+Shift+Left  | Focus the rail group to the left of the one currently focused | <!-- claim:shortcut:alt-shift-left -->
| Alt+Shift+Right | Focus the rail group to the right of the one currently focused | <!-- claim:shortcut:alt-shift-right -->

- Alt+Up/Down/Home/End act on the focused group's transcript, whichever group that is <!-- claim:shortcut:jump-acts-on-focused-group -->
- Alt+Up/Down navigate relative to the visible area: previous means above the visible area, next means below <!-- claim:shortcut:jump-viewport -->
- Alt+Down past last message scrolls to bottom; Alt+Up past first message scrolls to top <!-- claim:shortcut:jump-boundary -->
- Jumped-to message scrolls to the top of the visible area and receives a brief highlight flash <!-- claim:shortcut:jump-highlight -->
- The right-hand column has no jump-to-top or jump-to-end binding - only step prev/next <!-- claim:shortcut:right-column-no-ends -->
- Browser Back and Forward move between rail groups too, but in visit order rather than the rail's ancestry order - stepping back can return to a branch no longer on the rail <!-- claim:shortcut:rail-back-forward-visit-order -->

### 2.4 Tab Interactions

| Shortcut         | Action                    |
|------------------|---------------------------|
| Double-click tab | Maximize panel (toggle)   | <!-- claim:layout:tab-double-click -->
| Middle-click tab | Close panel (except Chat) | <!-- claim:layout:tab-middle-click -->

- Session header strip "+" button: creates new session in current browser tab, focuses chat; Alt+Click or middle-click opens new session in new browser tab <!-- claim:layout:header-new-session -->
- "+" button has chevron dropdown with options: "New session", "New session in new browser tab", then one "New session - <name>" row per session bundle the workspace declares (§21.10) <!-- claim:layout:header-new-menu -->
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
| LEFT  | Session rail path: one entry per rail group, ordered by how each was started from inside the one to its left, each with that group's status dot, session name, and Stop button where that group owns its own container; the focused group's entry is visually marked | <!-- claim:layout:header-left-slot -->
| RIGHT | "+" new session button + chevron dropdown ("New session", "New session in new browser tab", one row per session bundle); workspace switcher | <!-- claim:layout:header-right-slot -->

When the main panel renders a board view, the LEFT slot replaces the path with a board icon and the board's name; clicking the name copies the board's filesystem path. <!-- claim:layout:header-board-view -->

- A browser tab hosts one session and the sessions it descended from, shown side by side on the session rail (§3.19); unrelated sessions still mean separate browser tabs <!-- claim:layout:single-session -->
- Clicking a path entry's name focuses that group; clicking the focused entry's own name focuses the chat textarea <!-- claim:layout:header-name-click -->
- Each entry's status dot shows its own session's state the way a Sessions panel row does (§5.1): purple while its agent works, a dimmer purple while it waits on background work, dark orange while it needs you, green otherwise while running, amber while stopping, gray when stopped or without a container; hovering the dot names the state <!-- claim:layout:header-status-dot -->
- An entry's Stop button appears when that entry's session has a running container of its own; clicking while it is responding opens a confirmation modal, while idle stops it silently — the focused entry's own responding state is known directly, so it alone can skip straight to a silent stop <!-- claim:layout:header-stop -->
- A side conversation offers no Stop button of its own — stopping it ends only that conversation, never the one it came from; this holds regardless of whether it is the focused entry or elsewhere on the path <!-- claim:layout:header-stop-thread -->
- Welcome state (no active session): the LEFT slot is empty; the RIGHT slot remains active <!-- claim:layout:header-welcome -->
- The header strip stays visible while a panel is maximized <!-- claim:layout:header-maximize -->
- The header strip has no right-click context menu — Stop is the only header-strip action; rename, pin/unpin, and "open in new browser tab" live in the SessionsPanel right-click menu <!-- claim:layout:header-no-context-menu -->
- Strip background fades from a neutral dark on the left edge to the workspace accent color on the right edge when a workspace accent is set; clears to a neutral dark when no accent is set <!-- claim:layout:header-accent-gradient -->
- Strip interactive elements (path entry name/Stop buttons, "+" new session split-button, workspace switcher trigger) tint toward a brightened workspace accent on hover when a workspace accent is set; tint clears to a neutral hover background when no accent is set <!-- claim:layout:header-accent-hover -->

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
- Moving to another session while a confirmation is open closes it without acting; Continue never reaches the session moved to <!-- claim:layout:confirm-modal-dismissed-on-switch -->

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

- The main panel shows exactly one of {welcome, chat, board} at a time; "chat" is the session rail (§3.19) - one or more groups, of which exactly one is focused <!-- claim:layout:main-panel-single-slot -->
- No tab bar appears on the main panel — the Session Header Strip (§2.6) is its sole chrome <!-- claim:layout:main-panel-no-tabs -->
- Opening a board (via Boards Panel click, bookmark, or deep-link) updates the URL to `#/workspaces/{id}/boards/{boardId}` and the main panel content swaps to that board <!-- claim:layout:main-panel-board-url -->
- A bare workspace URL (`#/workspaces/{id}`) shows welcome content in the main panel; the Session Header Strip remains visible <!-- claim:layout:main-panel-welcome-fallback -->
- Switching between chat and board (or vice versa) follows the active URL — bookmark click, board sidebar click, deep-link, and browser back/forward all swap the main panel content

---

## 3. Chat Panel

### 3.1 Message Display

- Messages grouped into **turns** (user message + assistant response); when the right column shows the work view, a turn's assistant response is empty in the transcript for any turn whose tool calls all moved to that column, leaving just the user message <!-- claim:chat:turns -->
- While such a turn is still running, the transcript shows a working indication under the user message, inside its own surface matching the assistant bubble; completion removes that surface with its indication, and nothing else in the transcript shifts <!-- claim:chat:work-view-emptied-turn-live -->
- A turn with nothing yet to show in the transcript shows its working indication inside its own surface, matching the assistant bubble; the indication never appears without that surface <!-- claim:turn:progress-pending-framed -->
- Turn shows duration badge (live ticking while active) <!-- claim:chat:duration-badge -->
- Duration format: compact ("5s", "1m 23s", "1h 5m 12s") <!-- claim:chat:duration-format -->
- Error turns have red left border <!-- claim:chat:error-border -->
- A turn shows its own outcome however many tools it ran and however many background agents answered during it: a turn that failed is marked failed, a turn that succeeded is not <!-- claim:chat:turn-outcome-after-tools -->
- The agent's closing message appears once in its turn, however many tools or background agents were working as the turn ended <!-- claim:chat:answer-shown-once -->
- A failure that arrives after a turn has finished shows its message below that turn and leaves the turn's outcome as it was <!-- claim:chat:failure-between-turns -->
- A message the agent never acknowledges before its connection fails shows as its own turn, marked failed <!-- claim:chat:unacknowledged-message-failed -->
- A reply that is only a result shows under the question that asked it, and that question's turn shows as failed while the turn before keeps its own outcome <!-- claim:chat:result-only-reply -->
- When the agent cannot answer because the workspace is not logged in, the turn shows as failed and says to run claudebox run in a terminal in that workspace to log in <!-- claim:chat:not-logged-in -->
- Any turn the agent reports as failed - not logged in, billing, rate limit, a rejected request, a server fault - shows as failed <!-- claim:chat:agent-reported-failure -->
- A session whose runtime fails to start shows a failure with its reason rather than accepting messages and losing them; a message sent while it is failed is refused, not silently dropped, and the failure is still visible after a reload <!-- skip:claim:chat:runtime-connect-failed --> (no e2e test reaches a runtime that fails to start)
- Completed turns show final duration <!-- claim:chat:completed-duration -->
- When a turn ends while background work it started is still running, the turn shows what the session is waiting on - the task's description, or the number of tasks when there are several - until that work finishes <!-- claim:chat:waiting-on-background -->
- A message sent while the session waits starts a turn as usual <!-- claim:chat:waiting-accepts-messages -->
- Background work still running when the session stopped counts as killed once the session is resumed; a stopped session never shows waiting <!-- claim:chat:waiting-ends-on-stop -->
- Between a background task finishing and the agent picking up again, the session shows its working indication <!-- claim:chat:waiting-pickup-working -->
- Pending turns render at reduced opacity <!-- claim:chat:pending-opacity -->
- A pending message shows only in the session it was sent from; switching away hides it and returning shows it until the message is confirmed <!-- claim:chat:pending-session-scoped -->
- Stopping and the working indicator reflect only the open session's own messages <!-- claim:chat:pending-no-foreign-stop -->
- A new session's first message is sent to that session only <!-- claim:chat:first-message-own-session -->
- Empty state: "Waiting for messages..." <!-- claim:chat:empty-state -->
- Assistant messages rendered as markdown (code blocks, inline code, lists, links, LaTeX math); the same renderer is used for ticket detail content so chat and ticket markdown look identical <!-- claim:chat:markdown -->
- Inline code holding just a colour - #RRGGBB, rgb(R, G, B) or hsl(H, S%, L%) - shows a small swatch of that colour after the value <!-- claim:chat:color-swatch -->
- All six heading levels appear as headings of one style, stepping down in size, the smallest two just below body text size <!-- claim:chat:heading-levels -->
- Inline math may be written $x$ or, as on GitHub, $`x`$; both appear as the same typeset formula, and the backtick form may contain a dollar sign <!-- claim:chat:inline-math-forms -->
- Messages may include common inline and block HTML — collapsible details/summary, keyboard keys, definition lists, figures, and tables with merged cells — which appears as formatted content rather than literal tag text <!-- claim:chat:html-content -->
- A details block appears as an expandable section the reader can open and close <!-- claim:chat:html-details-toggle -->
- Unsafe HTML in a message never runs: scripts, inline event handlers, and javascript: links are removed, and embedded frames and standalone vector graphics do not appear <!-- claim:chat:html-safe -->
- A link in a message to a web address opens in a new tab without giving the opened page access back to the app <!-- claim:chat:html-link-safe -->
- A link in a message to a relative file path, such as docs/guide.md, points into the directory the agent works in; hovering shows the full path, clicking copies it, and Alt+Click opens it in your editor the same way as a highlighted path <!-- claim:chat:relative-link -->
- A relative link that would lead outside the agent's working directory appears as plain text <!-- claim:chat:relative-link-confined -->
- An image in a message with a relative path, such as ./out/plot.png, displays the file from the agent's working directory, fitted to the message width, including in a stopped session <!-- claim:chat:relative-image -->
- A relative image shows the file's current contents; after the agent rewrites the file, a message showing it again shows the new version <!-- claim:chat:relative-image-fresh -->
- An image in a message at a path under /tmp displays the file from that session's own temp directory, including in a stopped session <!-- claim:chat:temp-image -->
- A relative or /tmp image that is missing, is not an image, or would lead outside its directory shows as an unloadable image with its description <!-- claim:chat:relative-image-confined -->
- In a markdown file shown in a tool result, relative links and images point into that file's own folder <!-- claim:chat:relative-path-preview -->
- In a page fetched from the web, a relative link opens the address next to that page in a new tab, and a relative image shows the picture from that site <!-- claim:chat:relative-link-web -->
- In a skill's instructions, relative links and images point into that skill's own folder <!-- claim:chat:relative-link-skill -->
- A relative link in web search results, a ticket's details, or output from a connected tool server or a tool the app does not know appears as plain text <!-- claim:chat:relative-link-unanchored -->
- In markdown printed by a command or a background task, relative links and images point into the directory the agent works in <!-- claim:chat:relative-link-tool-output -->
- A link to another part of the same message - a footnote, a heading, a named anchor - scrolls to that part and highlights it, staying in the same tab <!-- claim:chat:in-message-links -->
- Footnotes appear at the end of their message, each with a link back to where it is referenced <!-- claim:chat:footnotes -->
- A quote that opens with [!NOTE], [!TIP], [!IMPORTANT], [!WARNING] or [!CAUTION] on its own line appears as a callout: an edge and a header in that kind's colour, the header showing the kind's icon and name, and the marker line itself hidden <!-- claim:chat:markdown-alerts -->
- Large sessions with many turns stay responsive: only the turns near the viewport are built, so opening and scrolling a long conversation costs the same whether it holds twenty turns or a thousand <!-- claim:chat:virtualized-render -->
- Turns outside the viewport are not present in the page, so the browser's own find-on-page and Print/Save-as-PDF reach only the turns currently on screen; scrolling to a turn brings it back <!-- claim:chat:offscreen-turns-absent -->
- A session with a long history stays usable while it loads: the tab keeps responding, the page stays put, and the message box accepts typing throughout <!-- claim:chat:replay-stays-responsive -->

**Turn Progress Indicators:**

- Active turn shows a rotating ring with "Working..." and animated dots; in the Focused view the line can name a hidden call in place of "Working", as below, and in every other view it reads "Working...". Stopping and compacting show the same ring <!-- claim:turn:progress-working -->
- In the Focused view, while the newest thing to arrive in the turn is a call the view hides, the line names that call, followed by the same animated dots <!-- claim:turn:progress-names-hidden-call -->
- Reading a file shows `Reading <file name>...`; a file or text search shows `Searching for <pattern>...`; a web search shows `Searching the web for <query>...`; fetching a page shows `Fetching <site>...`; loading a skill shows `Loading <skill name> skill...` <!-- claim:turn:progress-hidden-call-phrases -->
- A hidden command shows its description, or, when it has none, `Running <first command>...` - the command up to its first `;`, `&&`, `||`, `|` or line break. A hidden tool from a connected tool server shows `Running <tool name>...`, and reading another session shows `Running session_read...` <!-- claim:turn:progress-hidden-command -->
- Any other hidden call shows "Working...": reading the task list, a task or a background task's output, searching for connected tools, and listing or reading a tool server's resources <!-- claim:turn:progress-hidden-other -->
- The line keeps naming a call after the call finishes, until the next thing arrives in the turn - thinking, text, or another call; it then names that call if the view hides it, and otherwise reads "Working..." <!-- claim:turn:progress-follows-newest -->
- A tool-schema search, and the agent marking the session as needing you, leave the line as it is <!-- claim:turn:progress-calls-not-counted -->
- Calls a subagent makes leave the line as it is; the subagent's own block shows its activity <!-- claim:turn:progress-subagent-calls -->
- The line stays on one line and shows only the first line of a name; a name too long for it is cut with an ellipsis at the column's edge, and the dots stay visible after the cut <!-- claim:turn:progress-label-one-line -->
- While the session waits on background work, the ring turns at half the working speed, dimmed, and centred on its label <!-- claim:turn:progress-waiting-ring -->
- When stopping, displays "Stopping..." instead of "Working..." <!-- claim:turn:progress-stopping -->
- Completed turns show a "worked for [duration]" summary, led by a green ✓, or a red ✗ when the turn failed; appears only when the current runtime reports cost telemetry <!-- claim:turn:progress-complete --> <!-- claim:cost-display:capability-gated -->
- Hovering "worked for" shows the date and time the turn ended <!-- claim:turn:progress-complete-hover -->
- The compaction indicator appears only while a compaction is in progress, then clears when the compaction completes <!-- claim:chat:compaction-indicator-bounded -->
- The auto-compaction indicator appears only when the current runtime fires pre-compact lifecycle hooks <!-- claim:auto-compact-indicator:capability-gated -->

**Setting Change Dividers:**

- Horizontal divider rendered between turns when model, permission mode, or effort level changes mid-conversation <!-- claim:turn:setting-change-divider -->
- Effort level divider labeled `Effort: <level>` <!-- claim:turn:effort-change-divider -->
- Amber divider appears at the resume point whenever a session resumes with prior messages in the chat; labeled `Restarted` for an ordinary restart, or `Forked from <parent>` on the first viewing of a forked session <!-- claim:turn:container-restart-divider -->
- Reopening a session under a workspace whose runtime has changed since the session was created shows a red warning divider naming both runtimes, instead of silently running the new one <!-- claim:turn:runtime-mismatch-divider -->
- Dividers that fall back to back between two messages show as one divider naming each change once: a setting shows the value it ended on, and any number of restarts shows a single "Restarted". A fork or runtime-mismatch divider always keeps its own line <!-- claim:turn:divider-run-merged -->

### 3.2 Input Behavior

| Feature             | Behavior                                                                     |
|---------------------|------------------------------------------------------------------------------|
| Auto-resize         | Textarea grows with content, capped at roughly ⅓ of panel height             | <!-- claim:input:autoresize -->
| Scroll compensation | Chat scroll adjusts when textarea shrinks (if not autoscrolling)             | <!-- claim:input:scroll-compensation -->
| Draft persistence   | Draft saved automatically per session                                        | <!-- claim:input:draft-save -->
| Editing shortcuts persist | Text shaped with a composer editing shortcut (tag-wrap, block collapse/expand, bracket auto-pair) is saved and restored exactly like typed text | <!-- claim:input:editing-keys-persist -->
| Draft restoration   | Only restored when textarea is empty (prevents overwriting user input)       | <!-- claim:input:draft-restore -->
| Draft flush         | Page close triggers immediate save of current draft                          | <!-- claim:input:draft-flush -->
| Draft kept while the session lives | A session's draft, input history, inline replies and queued messages are kept as long as the session exists in any workspace, even while another workspace cannot be reached | <!-- claim:input:draft-kept-while-live -->
| History             | Up/Down arrows navigate submitted messages; edits update item in-place; persists across page reloads | <!-- claim:input:history-nav -->
| History retention   | History keeps only a bounded number of the most recent entries; once the limit is reached, the oldest entries drop as new ones are added | <!-- claim:input:history-retention-bound -->
| Draft stack         | Down pushes to stack; Up navigates through drafts then history (non-destructive); edits update in-place; submit from draft removes it from stack and adds to history | <!-- claim:input:draft-stack -->
| Failed send preserved | A message that fails to send stays in the box with its draft intact, and a queued message that fails returns to the queue; text kept after a lost connection returns only to the session it was typed in | <!-- claim:input:failed-send-preserved -->
| Typed while sending  | Text typed or attached while the previous message is still sending stays in the box once that message lands | <!-- claim:input:typed-while-sending-kept -->
| Enter while sending  | Enter pressed while the previous message is still sending sends the box's text right after it, in order; Enter pressed twice on the same text sends it once; if the first fails, the second stays in the box unsent | <!-- claim:input:enter-while-sending -->
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
- Clicking empty chat space focuses the prompt textarea; clicking message content does nothing and preserves OS-standard text selection (double-click selects the word, drag selects a range); selecting text in a message additionally shows a small floating quote button near the selection <!-- claim:chat:selection-not-preempted -->
- Stopping the active session immediately deselects it: the main area transitions to the welcome screen and the session appears as stopped in the sessions panel <!-- claim:session:stop-transitions-to-welcome -->
- Slash commands in user messages render with bold weight; recognised commands also show a subtle dotted underline and a hover card with usage, description, and metadata; unrecognised commands render with bold weight only <!-- claim:chat:user-message-slash-command-styling -->
- The slash-command autocomplete appears only when the current runtime supports skills; when unsupported, typing `/` types the literal character with no dropdown <!-- claim:slash-autocomplete:capability-gated -->

### 3.4 Following New Responses

| State                        | Behavior                   |
|------------------------------|----------------------------|
| User near bottom             | View follows new content as it streams in | <!-- claim:chat:autoscroll-bottom -->
| User moves the view off the bottom (scrolling, wheel, touch, Alt+Up/Down/Home/End, or a control-bar jump button) | View stops following immediately and stays where the user left it, even while new content arrives | <!-- claim:chat:autoscroll-disable -->
| View returns to the bottom (scrolling back, Alt+End, Alt+Down past the last message, or the control-bar jump-to-bottom button) | View resumes following new content; no jump-to-bottom button or other affordance | <!-- claim:chat:autoscroll-reenable -->
| Scroll within code block / nested scrollable | View keeps following; only scrolling the conversation itself stops it | <!-- claim:chat:auto-scroll-ignores-nested-scroll -->
| Click bookmark for active session | Stops following when the resulting position will not be at the bottom; if the target keeps the chat scrolled to the bottom, the view keeps following | <!-- claim:chat:bookmark-click-respects-autoscroll -->
| Click a task in the Tasks panel | Governs whichever column the task's block landed in - stops that column's following when the resulting position will not be at the bottom, keeps it following when the target is at the bottom; the other column is untouched | <!-- claim:chat:task-click-respects-autoscroll -->
| Tab switch                   | Preserve scroll position   | <!-- claim:chat:autoscroll-tab-switch -->
| Session rename               | Preserve scroll position across rename via chat control bar pencil, sessions panel right-click, or panel-tab right-click | <!-- claim:chat:rename-preserves-scroll -->
| During streaming             | Scrolling feels as smooth as when no response is in flight | <!-- claim:chat:autoscroll-streaming-responsive -->

### 3.5 Pending Messages

- Shown immediately after send (before server confirmation) <!-- claim:turn:pending-show -->
- Removed when server confirms the message <!-- claim:turn:pending-remove -->
- Prevents duplicate display <!-- claim:turn:pending-no-duplicate -->

### 3.6 Chat Control Bar

Control bar at top of Chat panel with two groups: <!-- claim:chat:control-bar --> with the terminal column shown, the bar divides at the column boundary - the two groups below sit left of it, and the terminal's own group sits right of it <!-- claim:chat:control-bar-divides-with-terminal -->

**Left group:**

| Control | Icon | Action |
|---------|------|--------|
| Pin | Pin icon | Toggle pinned state for current session; pressed when pinned | <!-- claim:chat:control-pin -->
| Rename | Pencil icon | Enter inline edit mode to rename session; disabled when no session | <!-- claim:chat:control-rename -->
| | | Separator | <!-- claim:chat:control-rename-separator -->
| Reload | Refresh icon | Restart session (picks up config changes); moving to another session before the restart finishes leaves you on the session moved to | <!-- claim:chat:control-reload -->
| Compact | Package icon | Send `/compact` message to trigger compaction; appears only when the current runtime supports manual compaction | <!-- claim:chat:control-compact --> <!-- claim:manual-compact-button:capability-gated -->
| Fork | Fork icon | Split-button: main button forks entire session (reuse container); chevron opens dropdown with fork variants. Alt+click or middle-click on the main button forks into a new browser tab. While a fork initiated from this control bar is in flight, the icon shows a spinner and both buttons disable — same as the per-turn rewind control. Appears only when the current runtime supports session forking. | <!-- claim:chat:control-fork --> <!-- claim:fork-button:capability-gated -->
| | | Separator | <!-- claim:chat:control-fork-separator -->
| Session Prompt | Note icon | Toggle dropdown editor for per-session prompt text | <!-- claim:chat:control-session-prompt -->
| Auto-collapse | Chevrons-down-up icon | Toggle auto-collapse of earlier turns, keeping only the last turn expanded; on by default; pressed when on | <!-- claim:chat:turn-autocollapse-toggle -->
| View picker | Three buttons: eye, split-square-horizontal, wrench | The chat has four views: Focused, Everything, Terminal and Work. With no button selected the chat is Focused; each button shows more - the eye (Show everything) shows every call in its turn, the terminal button also moves the session's shell commands to a right column, the wrench moves every tool call to a right column. Clicking a button selects its view and clicking the selected one returns to Focused, so at most one is selected | <!-- claim:chat:control-terminal-split --> <!-- claim:chat:right-slot-views-exclusive -->

**Right group:**

| Control | Icon | Action |
|---------|------|--------|
| Previous message | Chevron up | Jump to previous human message | <!-- claim:chat:control-prev -->
| Next message | Chevron down | Jump to next human message | <!-- claim:chat:control-next -->
| | | Separator | <!-- claim:chat:control-jump-separator -->
| Last message | Down-arrow-to-line | Scroll to bottom; pressed+disabled when autoscroll enabled | <!-- claim:chat:control-bottom -->
| | | Separator | <!-- claim:chat:control-nav-separator -->
| Minimap toggle | Map icon | Toggle minimap pinned/transient | <!-- claim:chat:control-minimap -->

**Terminal group** (right of the division, present only while the terminal column is shown):

| Control | Icon | Action |
|---------|------|--------|
| Previous entry | Chevron up | Step to the nearest entry above the visible area | <!-- claim:chat:control-terminal-prev -->
| Next entry | Chevron down | Step to the next entry below the visible area | <!-- claim:chat:control-terminal-next -->
| Last entry | Down-arrow-to-line | Jump to the terminal column's newest entry and resume following; pressed+disabled when already following - same semantics as the transcript's own | <!-- claim:chat:control-terminal-bottom -->
| Overview toggle | Map icon | Toggle the terminal's own overview pinned/transient, independent of the transcript's minimap toggle | <!-- claim:chat:control-terminal-minimap -->

**Work group** (right of the division, present only while the work column is shown):

| Control | Icon | Action |
|---------|------|--------|
| Previous turn | Chevron up | Step to the nearest working turn above the visible area | <!-- claim:chat:control-work-prev -->
| Next turn | Chevron down | Step to the next working turn below the visible area | <!-- claim:chat:control-work-next -->
| Last turn | Down-arrow-to-line | Jump to the work column's newest entry and resume following; pressed+disabled when already following - same semantics as the transcript's own | <!-- claim:chat:control-work-bottom -->
| Overview toggle | Map icon | Toggle the work column's own overview pinned/transient, independent of the transcript's and the terminal's minimap toggles | <!-- claim:chat:control-work-minimap -->

### 3.7 Message Timestamps

- Each turn shows timestamp right of duration counter <!-- claim:chat:timestamp -->
- Format: relative ("2m ago", "1h ago"), full datetime on hover <!-- claim:chat:timestamp-format -->
- Timestamp corresponds to when the turn started <!-- claim:chat:timestamp-source -->
- No visual effects on hover (no icon change, no color change) <!-- claim:chat:timestamp-no-hover -->
- Each user message shows when it was sent at its top-right, in the same format, style and hover behavior as the turn's timestamp; hovering shows the date and time it was sent <!-- claim:chat:user-timestamp -->
- A user message not yet confirmed by the session shows no timestamp until it is <!-- claim:chat:user-timestamp-pending -->
- A user message's action buttons appear on hover to the left of its timestamp, and its text never runs under the timestamp <!-- claim:chat:user-timestamp-layout -->
- Turn and user-message timestamps keep up as time passes, on finished turns as on the one in progress <!-- claim:chat:timestamp-live -->

### 3.8 Collapsible Turns

- Click turn header to collapse/expand <!-- claim:turn:collapsible -->
- Collapsed: full user message + assistant first line + status + metadata, for a turn that has an assistant response; a turn whose response moved entirely to the work column has no assistant first line to show, since it has no assistant response left in the transcript <!-- claim:turn:collapsed-content -->
- Collapsed preview strips markdown to plain text (no raw `**bold**`, `# headers`, etc.) <!-- claim:turn:preview-strip-markdown -->
- Text written with angle brackets that is not markup, such as a < b, appears in the collapsed preview as written <!-- claim:turn:preview-keeps-angle-brackets -->
- A turn whose blocks all moved to the work column shows a collapsed preview naming no tool count, since none of its tool calls are in the transcript to count <!-- claim:chat:work-view-emptied-turn -->
- When a reply's visible content is only code, only a table, or only an image, the collapsed preview shows the first line of that content instead, and the turn keeps its normal collapsed height <!-- claim:turn:collapsed-preview-fallback -->
- Collapsed content remains searchable via browser Ctrl+F <!-- claim:turn:collapse-css -->
- With auto-collapse on, only the last turn stays expanded; turning it off expands every collapsed turn, and when a new turn arrives the previously-last turn collapses; a turn you expand by hand stays open as new turns arrive, until you collapse it by hand or turn auto-collapse off and back on <!-- claim:chat:turn-autocollapse-behavior -->

### 3.9 Input State

Chat input border shows the session's state without animating <!-- claim:input:animation -->

- **Working**: Border shows the accent colour <!-- claim:input:anim-working -->
- **Focus**: Glow box-shadow when focused <!-- claim:input:anim-focus -->
- **Focus color**: Green border and glow, still <!-- claim:input:anim-focus-color -->

### 3.10 Mini-map

This section describes the transcript's own overview. The terminal column has a separate one - see **Terminal overview** below. On the session rail (§3.19), the minimap belongs to the focused group alone - an unfocused group has none. <!-- claim:chat:minimap-focused-group-only -->

Conversation overview sidebar (replaces native scrollbar): <!-- claim:chat:minimap -->

**Structure:**
- **Segments**: One segment per compaction period; no gap between segments <!-- claim:chat:minimap-segment-structure -->
- **Sub-bars**: Each turn is a sub-bar within its segment (no vertical gaps between sub-bars) <!-- claim:chat:minimap-sub-bars -->
- Two alternating muted colors (blue-gray and purple) per segment <!-- claim:chat:minimap-alternating-colors -->
- White horizontal lines mark human messages (at start of sub-bar) <!-- claim:chat:minimap-human-lines -->
- Human line height proportional to human message size <!-- skip:claim:chat:minimap-human-lines-proportional -->

**Dimensions:**
- Sub-bar height proportional to actual rendered height of turn content (scrollbar replacement) <!-- claim:chat:minimap-sub-bar-height -->
- A collapsed turn's sub-bar matches its collapsed height and grows back when the turn expands, whether collapsed by hand or by auto-collapse, and whether or not it is on screen <!-- claim:chat:minimap-sub-bar-collapse -->
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
- On opening a session, each subbar's size reflects its turn's content shape from the start and adjusts once to the turn's real size the first time that turn is shown <!-- claim:chat:minimap-warm-from-cold -->

**Toggle:**
- Toggle button in chat control bar (Map icon, after separator, rightmost in right group) <!-- claim:chat:minimap-toggle -->
- Pressed state when minimap is pinned to always-visible <!-- claim:chat:minimap-toggle-pressed -->
- When pinned: minimap stays visible (no auto-hide) <!-- claim:chat:minimap-toggle-persistent -->
- When unpinned: minimap returns to transient show/hide behavior <!-- claim:chat:minimap-toggle-transient -->
- Toggle state persisted per session; default: pinned (always-visible) <!-- claim:chat:minimap-toggle-persist -->
- Never shows another session's pinned state - pinned until the session's own is known, and pinned when it cannot be read; a toggle made while it loads stands <!-- claim:chat:minimap-toggle-session-scoped -->
- In every column that has one - transcript, terminal, work - a pinned overview keeps that column's own content ending clear of it, the same gap in each; unpinning returns the content to running underneath it on hover, as before it was pinned <!-- claim:chat:minimap-pinned-inset -->

**Terminal overview:**

With the terminal column shown, it carries its own overview down its own right edge, toggled from its own control-bar group and persisted independently of the transcript's minimap: <!-- claim:chat:terminal-minimap -->

- One bar per command run in the session, oldest at the top, in the same order as the column; no segments and no human-message lines - those are compaction/turn concepts the terminal has no equivalent of <!-- claim:chat:terminal-minimap-no-segments -->
- Bar height is proportional to the command's share of the column's content <!-- claim:chat:terminal-minimap-bar-height -->
- Bar width reflects the command's duration, normalized across every command in the session <!-- claim:chat:terminal-minimap-bar-width -->
- Bar colour reflects the command's exit status; a still-running command's bar is present but carries neither a passed nor a failed colour until it lands <!-- claim:chat:terminal-minimap-bar-status -->
- Visibility, click-to-jump, drag-to-scroll, the visible-area indicator, and auto show/hide behave the same way the transcript's overview's do <!-- claim:chat:terminal-minimap-shared-behavior -->
- The two overviews toggle and persist independently - pinning or unpinning one never changes the other <!-- claim:chat:terminal-minimap-independent -->

**Work overview:**

With the work column shown, it carries its own overview down its own right edge, toggled from its own control-bar group and persisted independently of the transcript's and the terminal's: <!-- claim:chat:work-minimap -->

- One bar per turn that routed something to the column, oldest at the top, in the same order as the column; no segments and no human-message lines, the same as the terminal's own <!-- claim:chat:work-minimap-no-segments -->
- Bar height is proportional to the turn's share of the column's content <!-- claim:chat:work-minimap-bar-height -->
- Bar width reflects the turn's duration, normalized across every working turn in the session <!-- claim:chat:work-minimap-bar-width -->
- Bar colour reflects whether any of the turn's calls failed; a turn with a call still unresolved shows neither a passed nor a failed colour until it settles <!-- claim:chat:work-minimap-bar-status -->
- Visibility, click-to-jump, drag-to-scroll, the visible-area indicator, and auto show/hide behave the same way the other two overviews' do <!-- claim:chat:work-minimap-shared-behavior -->
- All three overviews toggle and persist independently - pinning or unpinning one never changes another <!-- claim:chat:work-minimap-independent -->

### 3.11 Media Attachments

Attach files/images to messages: <!-- claim:input:attachment -->

| Feature | Behavior |
|---------|----------|
| Drag-drop | Drop zone on input area | <!-- claim:input:attachment-dragdrop -->
| Paste | Ctrl+V in textarea pastes images | <!-- claim:input:attachment-paste -->
| Preview | Preview row above input with remove (×) buttons (thumbnails for images, file icons for others) | <!-- claim:input:attachment-preview -->
| Max size | 10MB per file | <!-- claim:input:attachment-max-size -->
| Supported types | Any file type | <!-- claim:input:attachment-types -->

- Image attachments in message history appear correctly; an attachment-only send with an empty composer draws the thumbnails on the message's own surface, with no separate empty message box above them <!-- claim:chat:attachment-src -->
- A file or image attached to a new session's first message goes with it and is answered, whether the message was typed while the session opened or once it was open <!-- claim:input:attachment-first-message -->
- Click image attachment in message history to open zoom overlay <!-- claim:chat:attachment-zoom -->
- Escape, backdrop click, or close button closes zoom overlay <!-- claim:chat:attachment-zoom-close -->
- A message sent with a text file shows the message and the file's chip once; the agent's reply holds only its own answer <!-- claim:chat:attachment-text-once -->

### 3.12 Conversation Rewind

Fork conversation from any human message: <!-- claim:chat:rewind -->

- Rewind button on human messages (top-right, visible on hover); appears only when the current runtime supports session rewinding <!-- claim:chat:rewind-button --> <!-- claim:rewind-button:capability-gated -->
- Split-button: main button forks here (reuse container); chevron opens dropdown with variants <!-- claim:chat:rewind-split -->
- Confirmation modal only when forking in same container while Claude is responding; all other forks execute immediately <!-- claim:chat:rewind-modal -->
- Fork button shows spinner while forking is in progress <!-- claim:chat:fork-spinner -->
- Modal confirm button shows spinner and is disabled while forking is in progress <!-- claim:chat:rewind-modal-spinner -->
- Original session preserved; new session auto-switched <!-- claim:chat:rewind-fork -->
- The agent in a fork knows only the messages before the one forked at, whether that message carried attachments, inline replies or text typed beside an answer <!-- claim:chat:rewind-fork-forgets-later -->
- A fork whose source conversation's history cannot be found is not created; the fork control shows its failure message and the current conversation stays open and running <!-- claim:chat:fork-missing-history -->
- "Fork here" makes the new session the running one; the original session shows as not-running with its history still viewable; stopping affects only the new session <!-- claim:chat:fork-here-ownership-transfer -->
- "Fork in new tab" and "Fork in new browser tab" leave the original session running and start the new session as its own running session <!-- claim:chat:fork-new-tab-fresh-container -->
- Forked sessions nest in the sessions panel under the conversation they were forked from, under the Conversations and All filters - normally that conversation's own row, or its source conversation when the direct fork point has no row of its own (a promoted side conversation nests under the conversation its side thread came from, since the thread itself is never listed); the Threads and Subsessions filters show what a session came from instead of nesting <!-- claim:chat:rewind-tree -->
- Forked sessions inherit every parent session setting — name, automatic title, model, permission mode, effort level, session prompt, settings bundle — plus display metadata (timestamp, turn count, cost, message previews) on creation; values stay until the user changes them in the fork or the fork diverges naturally <!-- claim:chat:fork-metadata-inherit -->

**Fork variants** (available from both rewind button and control bar fork): <!-- claim:chat:fork-variants -->

| Variant | Container | Navigation |
|---------|-----------|------------|
| Fork here | Reuse current container | Replace current view | <!-- claim:chat:fork-here -->
| Fork in new browser tab | New container | Opens in a new browser tab | <!-- claim:chat:fork-browser-tab -->
| Fork as a side conversation | Shared with the source | Stays in place | <!-- claim:chat:fork-thread -->

A fork stands where the conversation it came from stood, and that conversation stays in the sessions panel under the conversation it was forked from. <!-- claim:chat:fork-rail-slot -->

Starting a side conversation keeps the source conversation running and does not add a row for it to the sessions list. <!-- claim:chat:fork-thread-non-disruptive -->

Full-session fork (control bar only): forks the entire conversation without truncation. Rewind button forks from the clicked message. <!-- claim:chat:fork-full -->

### 3.13 Copy Buttons

Copy buttons at multiple levels:

| Level | Content | Position |
|-------|---------|----------|
| Turn bubble | Full turn content | Top-right of turn | <!-- claim:chat:copy-button-turn -->
| Answer | The turn's last text block, as written | Right end of a finished turn's closing row, after "worked for" | <!-- claim:chat:copy-button-answer -->
| Message part | One paragraph, heading, list, table, quote, formula or HTML block of an assistant message, as written | Top-right of that part while hovered, after its bookmark button; inside the box of a quote, callout or table, clear of its edges | <!-- claim:chat:copy-button-block -->
| Code block | Code content | Top-right of code block | <!-- claim:chat:copy-button-code -->
| Quote | The quote's own text with its formatting, without its own leading `>` | Top-right of the quote | <!-- claim:chat:copy-button-quote -->
| Callout | Callout body as markdown, without its marker line or quote markers | Top-right of callout | <!-- claim:chat:copy-button-alert -->

All code blocks in the app have copy buttons (markdown, tool output, commands, etc.).

All quotes in formatted text have copy buttons - messages, thinking, tool output, ticket details. A quote inside another quote keeps its own marker when the outer one is copied. <!-- claim:chat:copy-button-quote-everywhere -->

- A quote standing on its own in an assistant message copies through its part button, without its own leading `>`, and shows no separate quote button <!-- claim:chat:copy-button-block-quote -->
- Code blocks, diagrams and dividers in an assistant message have no part button; code blocks and diagrams keep their own controls <!-- claim:chat:copy-button-block-exclusions -->
- A part's buttons never cover its text: its first line stops short of the corner they appear in, so a link anywhere in the part can be clicked while it is hovered <!-- claim:chat:part-buttons-clear -->

**User message copy:** <!-- claim:chat:copy-button-user -->

Copying a user message transforms special content to readable form:

| Content | Copied as |
|---------|-----------|
| Slash command | `/command args` | <!-- claim:chat:copy-slash-command -->
| Question response | Q/A text only, plus any note it was sent with | <!-- claim:chat:copy-askuser -->
| Command output | Output text only | <!-- claim:chat:copy-stdout -->
| Arbitrary XML | Unchanged | <!-- claim:chat:copy-arbitrary-xml -->

### 3.14 Mermaid Diagrams

Mermaid code blocks render as visual diagrams: <!-- claim:chat:mermaid -->

- ` ```mermaid ` blocks render as SVG diagrams instead of code text <!-- claim:chat:mermaid-render -->
- Toggle button switches between diagram and syntax-highlighted source <!-- claim:chat:mermaid-toggle -->
- Invalid mermaid syntax falls back to a syntax-highlighted code block <!-- claim:chat:mermaid-fallback -->
- A diagram that cannot be drawn shows a failure notice above its source, naming the reason <!-- claim:chat:mermaid-failure-notice -->
- Click diagram to open zoom overlay for inspecting complex diagrams <!-- claim:chat:mermaid-zoom -->
- The overlay opens showing the whole diagram, both axes - a diagram smaller than the viewport opens at its natural size rather than enlarged to fill it <!-- claim:chat:mermaid-zoom-whole -->
- A zoom in, zoom out, fit, and four directional controls sit in the overlay's bottom-left corner <!-- claim:chat:mermaid-zoom-controls -->
- `+`/`=`/`-` zoom the same way the buttons do; the arrow keys pan the same way the directional controls do; both leave the page behind the overlay unscrolled <!-- claim:chat:mermaid-zoom-keys -->
- Scrolling the wheel over the diagram zooms about the pointer - whatever was under it stays under it; pressing and dragging pans, following the pointer <!-- claim:chat:mermaid-zoom-wheel -->
- Zooming stops at a minimum and a maximum; the control at whichever bound is reached reads unavailable <!-- claim:chat:mermaid-zoom-bounded -->
- The fit control returns to the opening view in one action; closing and reopening the overlay always starts at that view too, never wherever it was left <!-- claim:chat:mermaid-zoom-reset -->
- Escape or backdrop click closes zoom overlay; a drag that merely ends over the backdrop does not <!-- claim:chat:mermaid-zoom-close -->
- Diagram colors match dark theme palette <!-- claim:chat:mermaid-theme -->
- Diagram text uses the same typeface as the conversation, for every diagram type <!-- claim:chat:mermaid-font -->
- Copy button copies raw mermaid source <!-- claim:chat:mermaid-copy -->
- Non-mermaid code blocks unaffected <!-- claim:chat:mermaid-no-side-effect -->

### 3.14.1 Maps

GeoJSON and TopoJSON code blocks render as maps: <!-- claim:chat:geo-map -->

- A ```geojson or ```topojson block draws its shapes on a map fitted to them, on a plain background <!-- claim:chat:geo-map-render -->
- A map makes no request outside the app until the reader asks for map tiles <!-- claim:chat:geo-map-offline -->
- Each map has a "Load map" button that adds OpenStreetMap tiles to that map alone, with OpenStreetMap's attribution; the map keeps them until the page reloads <!-- claim:chat:geo-map-load-tiles -->
- Zoom controls, double-click and pinch zoom the map, and dragging pans it; zoom stops at a minimum and a maximum <!-- claim:chat:geo-map-zoom-pan -->
- Scrolling the wheel over a map scrolls the conversation <!-- claim:chat:geo-map-wheel -->
- Clicking a shape shows its properties as plain text <!-- claim:chat:geo-map-properties -->
- Toggle button switches between map and syntax-highlighted source; copy button copies the raw source <!-- claim:chat:geo-map-toggle -->
- A block that cannot be drawn shows its source with a failure notice naming the reason <!-- claim:chat:geo-map-fallback -->

### 3.14.2 3D Models

STL code blocks render as 3D models: <!-- claim:chat:stl -->

- A ```stl block holding an ASCII STL model draws as a shaded 3D model fitted to the view <!-- claim:chat:stl-render -->
- A model draws without any request outside the app <!-- claim:chat:stl-offline -->
- Dragging rotates the model, right-drag or Shift+drag pans, and zoom controls or pinch zoom; zoom stops at a minimum and a maximum <!-- claim:chat:stl-orbit -->
- Scrolling the wheel over a model scrolls the conversation <!-- claim:chat:stl-wheel -->
- A reset control returns to the opening view <!-- claim:chat:stl-reset -->
- Toggle button switches between model and syntax-highlighted source; copy button copies the raw source <!-- claim:chat:stl-toggle -->
- A block that cannot be drawn, including in a browser without 3D graphics, shows its source with a failure notice naming the reason <!-- claim:chat:stl-fallback -->

### 3.15 Session Prompt

Per-session editable text re-supplied to Claude after each compaction so it persists across long conversations, typed by the reader or set when a session starts under a bundle: <!-- claim:chat:session-prompt -->

| Feature | Behavior |
|---------|----------|
| Button | Note icon in control bar left group, after Compact | <!-- claim:chat:session-prompt-button -->
| Blue badge | Dot on button when content is set | <!-- claim:chat:session-prompt-badge -->
| Dropdown editor | Opens below button, left-aligned; textarea with monospace font | <!-- claim:chat:session-prompt-dropdown -->
| Save | Content saved on close (click outside or Escape) | <!-- claim:chat:session-prompt-save -->
| Before the first message | A prompt set on a new session before its first message is kept and survives a reload; the session then stays in the list even if no message is ever sent | <!-- claim:chat:session-prompt-before-first-message -->
| Clear | Empty/whitespace-only text clears the prompt | <!-- claim:chat:session-prompt-clear -->
| Persistence | Survives refresh and resume | <!-- claim:chat:session-prompt-persist -->
| Compaction | After compaction, prompt re-supplied to Claude | <!-- claim:chat:session-prompt-inject -->
| Disabled | Button disabled when no session loaded | <!-- claim:chat:session-prompt-disabled -->

### 3.16 Message Queue

Queue messages for sequential delivery while Claude is responding:

- Queued messages appear as dimmed inline bubbles below the current response <!-- claim:chat:queue-bubble -->
- Queued bubbles show send now (⇒), edit (✎), and cancel (✕) buttons on hover <!-- claim:chat:queue-actions -->
- Send now sends a queued message immediately, skipping queue order <!-- claim:chat:queue-send-now -->
- Queue drains FIFO — each completed reply or compaction boundary auto-sends the next queued message; replies replayed while a conversation is still loading do not <!-- claim:chat:queue-drain -->
- Interrupt pauses all queued messages (won't auto-send) <!-- claim:chat:queue-pause-interrupt -->
- A message that fails to send pauses that session's queued messages and returns to the front of its queue; other errors, and failures in other sessions, leave the queue running <!-- claim:chat:queue-pause-error -->
- A first message that fails to send while its new session opens leaves no working turn behind; it waits at the front of that session's queue, paused <!-- claim:chat:first-message-failed-queued -->
- Paused bubbles show re-queue (▶) and cancel (✕) buttons <!-- claim:chat:queue-pause-actions -->
- Edit returns message content to input textarea; message removed from queue <!-- claim:chat:queue-edit -->
- Cancel removes message from queue <!-- claim:chat:queue-cancel -->
- Re-queue returns paused message to active queue <!-- claim:chat:queue-requeue -->
- Enter sends immediately, bypassing queue; queued messages send after response completes <!-- claim:chat:queue-bypass -->
- Session switch restores that session's queued messages from storage <!-- claim:chat:queue-session-clear -->
- A message queued while a session is still loading is not queued; it stays in the composer, as with Enter <!-- claim:chat:queue-while-loading -->
- Queue persists per session; survives page refresh <!-- claim:chat:queue-persist -->
- Queued messages preserve attachments <!-- claim:chat:queue-attachments -->

### 3.17 Inline Replies

Quote any part of a turn - prose, code, tool output, or a thinking block - and reply beside the quoted span. A reply either sends on its own, without touching the conversation, or joins the others in the buffer to go out together as one turn. Quoting and replying are desktop-only.

- Selecting text anywhere in a turn - prose, code, tool output, or a thinking block - and clicking the quote button paints a durable highlight on the quoted span and opens a reply box beside it, pre-filled with the quoted text and its source (the user or the assistant) and with the reply field focused and empty <!-- claim:chat:inline-replies-quote -->
- While the quote button is showing, pressing Tab does exactly what clicking it does; inside the message box it indents as usual <!-- claim:chat:inline-replies-quote-tab -->
- In an open reply box, Tab with the cursor at the end of its text - an empty box included - closes the box exactly as its close button does; anywhere else in the box it indents <!-- claim:chat:inline-replies-tab-close -->
- Closing a reply box with Tab or with its close button puts the cursor back in the message box of the conversation it was quoted from, where it last was, with the draft there untouched; closing it by clicking its highlight leaves focus where the click put it <!-- claim:chat:inline-replies-close-focus -->
- Unsent replies accumulate, each editable in the reply box beside its quoted span; a reply can be deleted, which clears its highlight; the unsent replies and their highlights are restored after a page reload or a return to the session <!-- claim:chat:inline-replies-buffer -->
- A reply box restored by a return to its session opens closed, exactly as after a reload; only a reply just quoted opens by itself and takes the cursor <!-- claim:chat:inline-replies-restore-closed -->
- Sending from the message box delivers one turn carrying every reply still buffered there, plus the composer message and any attachments; each sent reply's highlight stays on its quoted span and its reply is shown read-only when the span is hovered or clicked; the send-turn shows a compact "Replied inline - N comments" placeholder that expands in place to reveal each quote and its reply; comments left with a blank reply are omitted; a reply-only send with an empty composer draws the placeholder on the message's own surface, with no separate empty message box above it. A reply already answered on its own is never part of this send <!-- claim:chat:inline-replies-send -->
- Each buffered reply reaches the assistant once: pressing Enter again, or Enter after a one-click reply or a question answer, while the message carrying it is still on its way sends nothing more of it; a reply added meanwhile waits for the next send, and if the message fails to send its replies stay buffered for the next one <!-- claim:chat:inline-replies-send-once -->
- In a reply box not yet answered on its own, Enter sends exactly what Enter in the message box sends - the message box, its attachments and every buffered reply, this one included - and the cursor then sits in the message box; Ctrl+Enter answers that reply on its own instead, and Alt+Enter does nothing there. In a box already answered on its own, Enter, Ctrl+Enter and Alt+Enter all ask its follow-up there <!-- claim:chat:inline-replies-enter-keys -->
- The placeholder is display-only: its wording never appears as raw text in the transcript, and it is the quote-and-reply pairs, not the placeholder, that reach the assistant <!-- claim:chat:inline-replies-placeholder-only -->
- The quoted span shows a dotted underline over a subtle fill and stays highlighted for the rest of the session and across reload; hovering a highlighted span briefly shows its reply beside the span, and clicking the span opens that reply box and clicking it again closes it; a reply sent from the message box shows read-only once sent, still editable while unsent, and its highlight is permanent; a reply answered on its own keeps showing its whole exchange and stays editable for a follow-up, however long ago it was asked - until it is promoted, after which it shows that same exchange permanently read-only with no reply field. Promoted onto the rail (below), clicking its span focuses that group instead of opening a box, and hovering shows the quote and its opening reply read-only with a control that does the same <!-- claim:chat:inline-replies-highlight -->
- With the mouse resting on a highlighted span, or on the reply box it briefly shows, Tab opens that reply box and keeps it open, with the cursor at the end of its reply field - even while the cursor was in the message box; a read-only box opens with nothing to type into, and a reply promoted onto the rail focuses its group instead. A selection showing the quote button keeps Tab for quoting, and an open slash-command list keeps it for its suggestion <!-- claim:chat:inline-replies-hover-tab -->
- Each reply box opens beside its highlighted span and stays beside it as the transcript scrolls; several reply boxes can be open at once without overlapping one another; hovering a highlight shows its box briefly, clicking the highlight opens the box and clicking it again closes it, and its close button also dismisses it - closing a box whose reply is still empty discards the quote and its highlight; a box holding its own answered exchange also offers two controls to promote it into a full group of its own, gone again once either is used, leaving only the close button. A reply promoted onto the rail has no box at all - its highlighted span is what reaches it from then on <!-- claim:chat:inline-replies-float -->
- A reply box opened near the edge of the conversation slides inward to stay fully visible instead of narrowing <!-- claim:chat:inline-replies-float-clamped -->
- Every reply box opens at the same size wherever its quote sits; dragging its bottom-right corner resizes it live, down to a minimum and no wider than the conversation, and resizing one box leaves every other box as it was <!-- claim:chat:inline-replies-float-resize -->
- A reply box's size is kept when it is closed and re-opened, across a return to its session, and after a page reload in any browser, for every kind of reply - including once it is sent; deleting or discarding the reply forgets it <!-- claim:chat:inline-replies-float-resize-persist -->
- The reply box supports the same text-editing keys as the message box: wrapping a selection, continuing a markdown list on a new line, indenting and dedenting, collapsing and expanding a block of text, auto-pairing quotes and brackets, and interrupting a response - each behaves exactly as it does in the message box <!-- claim:chat:inline-replies-editing-keys -->
- Message history, stash, and slash-command autocomplete stay with the message box; arrow keys in a reply box move the caret instead <!-- claim:chat:inline-replies-editing-excluded -->
- A collapsed block of text left in a reply is delivered in full when sent, never as its collapsed placeholder <!-- claim:chat:inline-replies-collapse-expands-on-send -->
- Answering a reply on its own, rather than sending it with the others, asks right there beside its quote and shows the answer arriving in the same box; the conversation it was quoted from is unchanged throughout - same turns, same count, no placeholder added for it <!-- claim:chat:inline-replies-standalone-ask -->
- Asking a reply on its own leaves the cursor in that box's empty follow-up field, so typing carries on there and Tab closes the box; closing it straight after asking keeps the quote, its highlight and the exchange <!-- claim:chat:inline-replies-standalone-ask-focus -->
- The first question a reply asks on its own carries the quoted span, then the reply typed beside it; a follow-up carries only what was typed. Nothing typed in the message box reaches it. Its box, and the card shown on hovering a reply promoted onto the rail, show that first question as the reply alone beneath the quote they already show; everywhere else the question shows the quote above the reply <!-- claim:chat:inline-replies-standalone-quote-sent -->
- A reply box shows its own exchange exactly as the conversation shows a turn - formatted text, code, tables, math and diagrams, thinking, tool calls with their results, and to-do lists alike - while the answer arrives, after a reload, and once promoted; every part shows inside the box, whatever the conversation sends to the work panel <!-- claim:chat:inline-replies-standalone-rendering -->
- A reply box asking on its own does not stop or wait for the conversation it was quoted from, whether that conversation is idle or already answering something else <!-- claim:chat:inline-replies-standalone-concurrent -->
- A reply asked on its own reaches its thread even when another session is opened while the thread is starting <!-- claim:chat:inline-replies-standalone-switch -->
- A box shows only the exchange it asked for; the conversation it was quoted from answers in the conversation, never in the box, whichever one is still arriving when the other finishes <!-- claim:chat:inline-replies-standalone-exclusive -->
- Reloading the page while a reply's own answer is arriving picks the box back up mid-answer rather than freezing it at the moment of reload, and the rest keeps filling in; reloading after it has finished shows the whole exchange, question and answer together <!-- claim:chat:inline-replies-standalone-reload -->
- Answering one reply on its own leaves every other buffered reply exactly as it was - still unsent, still editable, unaffected by the one that was asked <!-- claim:chat:inline-replies-standalone-isolated -->
- A reply answered on its own stops - however that answer ends, whether it completes, fails, or is interrupted - and typing a follow-up and pressing Enter starts it answering again with the whole earlier exchange still in view. This holds for a thread still in its float; once promoted onto the rail, it runs until stopped like any other group, the same as the conversation it came from <!-- claim:chat:inline-replies-standalone-lifecycle -->
- The follow-up field never locks while a box's own answer is still arriving - typing and pressing Enter work exactly as they do once it has finished, starting the next exchange immediately rather than waiting; each exchange's own text stays under the question that asked for it <!-- claim:chat:inline-replies-standalone-overlap -->
- While a reply box's own answer arrives, the box keeps its newest part in view as long as its end is in view; scrolling up inside the box stops that and leaves the view where it was left, scrolling a code block or table inside it does not, and scrolling back to its end or asking a follow-up resumes it <!-- claim:chat:inline-replies-standalone-follows -->
- A reply answered on its own can be promoted into a full session of its own, opening in a new browser tab; the reply box stops where it was, still showing everything said up to that point, permanently read-only, with a link to where the conversation continues, and stays that way across a reload <!-- claim:chat:inline-replies-standalone-promote -->

A reply answered on its own has three destinations: <!-- claim:chat:inline-replies-promote-variants -->

| Destination | Container | Where it lives |
|---|---|---|
| Stays in its float | Shared with the source | Beside its quote, in the source conversation |
| Promoted onto the rail | Shared with the source | A group on the source conversation's own rail, focused |
| Promoted to its own session | New container, new browser tab | Its own conversation |

Promoting a reply onto the rail gives it its own group there, focused, with the conversation it was quoted from immediately beside it, reading; the group is an ordinary child session in every respect but one - it opens at its own exchange, with what it inherited standing behind one line <!-- claim:chat:inline-replies-rail-promote -->

Promoting onto the rail works whether the reply has finished answering or is still answering - one still answering keeps answering in its group - and the promoted reply then keeps running after every answer, after a reload, and after leaving and coming back <!-- claim:chat:rail-promote-any-time -->

Everything done in the promoted group acts on the promoted reply: the messages sent there, the model, effort and permission choices, the session prompt and the full output of its tools; the conversation beside it is untouched <!-- claim:chat:rail-promoted-thread-acts-on-itself -->

That line names the conversation the turns came from and how many turns are behind it; clicking it reveals them in place, and clicking again folds them back - in every reading of the group, and again after a reload <!-- claim:chat:rail-promoted-thread-fold -->

Opening another conversation and coming back shows that line folded again; a group never opens unfolded because the group read before it was <!-- claim:chat:rail-promoted-thread-fold-per-group -->

Whichever of the three destinations a reply answered on its own takes, it is listed the same way in the sessions panel (§5.1 owns the filters that decide how; proven there, not here) <!-- skip:claim:chat:inline-replies-promote-listing -->

### 3.18 Views (Focused / Everything / Terminal / Work)

The chat shows a session in one of four views, picked in the control bar. Focused and Everything keep the whole conversation in one column. Terminal and Work split the chat content area into two columns, the transcript on the left and their own column on the right - desktop only, one right slot, one occupant. On the session rail, the views belong to the focused group alone - every claim in this section describes that group; the session rail's own section says what any other group shows.

**Focused and Everything:**

- On a desktop, a session that never picked a view opens Focused; a session where a view was picked opens in that view <!-- claim:chat:focused-view-default -->
- In Focused a turn leaves out the calls that only read: file reads, file and text searches, web searches and page fetches, task list lookups and background task output, tool searches, skill loads, shell commands that change nothing, the agent's own needs-you calls, its reads of other sessions, listings and reads of MCP resources, and MCP tool calls whose server declares the tool read-only. A shell command's own actions settle the question when it finishes, so a command left out while it ran can appear, and one shown while it ran can be left out <!-- claim:chat:focused-view-hides -->
- A call of one of those kinds that failed shows in Focused, marked failed as in any view <!-- claim:chat:focused-view-failed-shown -->
- A bookmarked call shows in Focused whatever its kind; removing its bookmark there leaves it out again <!-- claim:chat:focused-view-bookmarked -->
- Every other call shows in Focused exactly as in Everything: writes and edits, other shell commands, subagents, questions and plan approvals, task list changes, and every other MCP tool call <!-- claim:chat:focused-view-shows -->
- Inside a subagent's block, Focused leaves the same calls out of its activity <!-- claim:chat:focused-view-subagent -->
- A call Focused leaves out stays out of sight from the moment it starts; the turn shows its Working line, which can name that call (§3.1, Turn Progress Indicators) <!-- claim:chat:focused-view-while-running -->
- A finished turn in Focused shows no sign of the calls it left out: no row for them, and no count of them in the turn's folded one-line summary; a turn that made only such calls and wrote nothing shows only the user's message <!-- claim:chat:focused-view-no-trace -->
- In a session whose agent does not report which MCP tools are read-only, Focused shows every MCP tool call other than listings and reads of MCP resources <!-- claim:chat:focused-view-mcp-unreported -->
- A shell command or MCP tool call an earlier version of the app recorded shows in Focused, unless it lists or reads MCP resources <!-- claim:chat:focused-view-earlier-recordings -->
- With Show everything selected, every call shows in its turn, in call order, each in its usual folded or open state <!-- claim:chat:everything-view -->
- On a phone the chat is always Focused <!-- claim:chat:focused-view-phone -->
- A session opens already in its view; no call appears and then goes away as it opens <!-- claim:chat:focused-view-first-frame -->

**Hiding a tool from Focused:**

- Hovering the header of an MCP tool's block shows a hide button after its bookmark button, with the tooltip `Hide in Focused`; a tool Focused already hides on its own shows none <!-- claim:chat:focused-hide-tool-button -->
- Clicking it marks that tool: the button shows pressed and stays visible without hovering, its tooltip reads `Show in Focused`, and every block of the same tool shows it pressed <!-- claim:chat:focused-hide-tool-mark -->
- In Focused, every call of a marked tool is hidden - in the agent's own turns and inside a subagent's block alike - except a failed or bookmarked one, which shows as it does for any call Focused would hide; Show everything shows them all with their buttons pressed <!-- claim:chat:focused-hide-tool-hidden -->
- A mark covers one tool; the same server's other tools stay in Focused <!-- claim:chat:focused-hide-tool-one-tool -->
- Clicking a pressed button removes the mark, and Focused shows that tool's calls again <!-- claim:chat:focused-hide-tool-unmark -->
- Marks belong to the workspace: every session of it, in any browser, hides the same tools, and the marks are kept after a page reload; another open tab of the same browser follows at once <!-- claim:chat:focused-hide-tool-workspace -->
- A mark applies in sessions of every runtime; where a session names a tool without its server, a mark matches the tool of the same name <!-- claim:chat:focused-hide-tool-runtimes -->
- On a phone no block shows the hide button, and a marked tool's calls stay hidden <!-- claim:chat:focused-hide-tool-phone -->

**Shared by Terminal and Work:**

- The chat content area shows two columns of equal width, with a draggable boundary between them <!-- claim:chat:terminal-column -->
- Dragging the boundary between the columns resizes both live; neither column can be dragged below a minimum width <!-- claim:chat:terminal-split-divider -->
- The boundary position is restored after a page reload <!-- claim:chat:terminal-split-divider-persist -->
- The boundary between the columns extends up through the control bar, dividing it at the same point, including while the boundary is being dragged; when the column is hidden - by the picker, by a narrow panel, or on a phone - the bar is undivided <!-- claim:chat:terminal-split-divider-bar -->
- The bar never appears undivided and then divides, or divides at the wrong place and then moves - it is absent until the session's layout is known, then appears already divided <!-- claim:chat:terminal-split-divider-bar-no-flash -->
- The chosen view - Focused, Everything, Terminal or Work - is restored after a page reload, and each session keeps its own choice independently of any other open session <!-- claim:chat:right-slot-view-persist -->
- While a session is loading, one screen covers the whole chat content area - transcript, boundary and right view together - with no right view drawn beside it; the split is already in place underneath, so lifting the screen reveals it settled rather than reflowing into place <!-- claim:chat:loading-covers-split -->

**Terminal view:**

- A shell command the assistant runs appears in the terminal column instead of as a block in its turn; every other tool call still renders in its turn exactly as before <!-- claim:chat:terminal-column-routing -->
- A terminal entry shows the model's description as a dimmed comment line above the command, then the command on a prompt line, then its output beneath; a call with no description starts directly at the command <!-- claim:chat:terminal-entry-shape -->
- A command laid out over several lines starts on the prompt line, its other lines aligned beneath the first <!-- claim:chat:terminal-entry-command-lines -->
- A terminal entry's lines are never broken to fit the column; a line wider than the column scrolls sideways on its own, independent of the rest of the entry <!-- claim:chat:terminal-entry-no-wrap -->
- A command the tool reports as failed is marked on its command line; its output still shows beneath it <!-- claim:chat:terminal-entry-failure -->
- Every terminal entry shows its command and its output in full, whether or not the command changes anything <!-- claim:chat:terminal-entry-always-open -->
- A command the tool reports as failed is identifiable from the terminal's own overview without scrolling to it <!-- claim:chat:terminal-column-failure-visible-in-overview -->
- Hovering a terminal entry reveals its jump, bookmark and copy buttons, in that order from left to right; the copy button copies that command alone <!-- claim:chat:terminal-entry-copy -->
- The hover controls sit level with the entry's first line, whichever it is - the description comment when there is one, the command otherwise <!-- claim:chat:terminal-entry-controls-position -->
- A terminal entry's hover buttons are the same size, and sit the same distance apart, as the buttons that appear on hovering a part of an assistant message <!-- claim:chat:terminal-entry-controls-size -->
- A terminal entry's hover buttons share one fill, the terminal column's own background; the one under the pointer turns the same lighter shade whichever button it is <!-- claim:chat:terminal-entry-controls-fill -->
- A terminal entry appears as soon as its command text arrives, before the command completes; its output fills in beneath it once the call lands <!-- claim:chat:terminal-entry-running -->
- A terminal entry's output is coloured when its content is recognisable (e.g. JSON), the same way an inline tool block's output is; unrecognisable output, including markdown-looking text, stays plain <!-- claim:chat:terminal-entry-output-highlighting -->
- The terminal column shows every shell command run since the session started, oldest first, regardless of which turn ran it <!-- claim:chat:terminal-column-scope -->
- Entries outside the viewport are not present in the page, so the browser's own find-on-page and Print/Save-as-PDF reach only the entries currently on screen; scrolling to an entry brings it back <!-- claim:chat:terminal-column-offscreen-absent -->
- The terminal column scrolls to a newly landed entry when it was already scrolled to the bottom, and stays where it was left when it was scrolled up <!-- claim:chat:terminal-column-autoscroll -->
- The terminal column opens scrolled to its newest entry and follows further output until the reader scrolls away - on opening a session, and on choosing the terminal view mid-session - whether or not the URL names a turn <!-- claim:chat:terminal-column-lands-at-end -->
- While a shell command is still running, the terminal column stays scrolled to the bottom as its output arrives, not only once the command finishes <!-- claim:chat:terminal-column-follows-running-output -->
- Clicking a terminal entry's jump button scrolls the transcript to the turn that ran it and highlights it, including when that turn is not currently mounted; an entry belonging to a turn the transcript cannot address shows no jump button <!-- claim:chat:terminal-entry-jump -->
- Stepping to an entry, by button or by Alt+PageUp/PageDown, lands its top edge at the top of the column and flashes it; stepping past the last entry settles at the end and re-engages following, stepping past the first stays at the top; stepping away from the end stops the column following, and stepping back to it resumes following <!-- claim:chat:terminal-column-step -->
- A session that has run no shell commands shows the terminal column with a message stating none have run <!-- claim:chat:terminal-column-empty -->
- A subagent's shell commands stay nested inside its own activity section in the transcript and never appear in the terminal column <!-- claim:chat:terminal-column-subagent -->
- Releasing the terminal button returns the chat to Focused, where every shell command that changes something shows inline in its turn again, with the command and its output intact; the choice is restored after a page reload <!-- claim:chat:terminal-split-toggle-off -->

**Work view:**

The work view carries every tool call the agent makes, in chat's own block UI - a Bash call looks exactly like the Bash block it would have been inline, with header, description, Command and Result sections, not a terminal entry.

- Every top-level tool call the agent makes appears in the work column, in call order, and none of them appears in the transcript; the transcript keeps the user's messages, the assistant's prose, and its thinking <!-- claim:chat:work-view-routes-all-tools -->
- A work-column block looks and behaves exactly like the same block does inline, including expanding to its own output with the same default collapsed or expanded state <!-- claim:tool:work-block-parity -->
- A subagent's own calls stay nested inside its Task block; the Task block is what moves to the work column, and the subagent's calls are not listed separately alongside it <!-- claim:tool:work-task-nested-excluded -->
- The work column shows every tool call since the session started, oldest first, grouped by the turn that made it <!-- claim:chat:work-column-scope -->
- Entries outside the viewport are not present in the page, so the browser's own find-on-page and Print/Save-as-PDF reach only the entries currently on screen; scrolling to an entry brings it back <!-- claim:chat:work-column-offscreen-absent -->
- A session that has used no tools shows the work column with a message stating none have run; a brand-new session shows the same message before anything is sent <!-- claim:chat:work-column-empty -->
- Clicking a work-column block's jump affordance scrolls the transcript to the turn that made the call and highlights it, including when that turn is not currently mounted <!-- claim:chat:work-entry-jump -->
- The work column scrolls to a newly landed call when it was already scrolled to the bottom, and stays where it was left when it was scrolled up <!-- claim:chat:work-column-autoscroll -->
- The work column opens scrolled to its newest entry and follows further calls until the reader scrolls away - on opening a session, and on choosing the work view mid-session <!-- claim:chat:work-column-lands-at-end -->
- While a turn is still making calls, the work column stays scrolled to the bottom as each one lands, not only once the turn ends <!-- claim:chat:work-column-follows-active-turn -->
- The work column's following state is its own - scrolling the transcript never disengages it, and scrolling it never disengages the transcript's <!-- claim:chat:work-column-independent-autoscroll -->
- Stepping to a turn, by button or by Alt+PageUp/PageDown, lands its top edge at the top of the column and flashes it; turns that did no work are never a stop; stepping past the last working turn settles at the end and re-engages following, stepping past the first stays at the top; stepping away from the end stops the column following, and stepping back to it resumes following <!-- claim:chat:work-column-step -->
- Clicking a task in the Tasks panel lands its block's top edge at the top of the work column and flashes it, the same landing the step controls use; the transcript does not move. Landing off the bottom stops the work column following; landing on the newest task leaves it following <!-- claim:chat:work-column-task-click -->

### 3.19 Session Rail

Depth has its own axis, separate from the transcript/right-column split above. A session that spawned children - a side thread promoted to its own session, or a sibling an agent started, and only those two - shows them alongside it on a horizontal rail, root at the left: <!-- claim:chat:rail -->

- Forking a conversation, by any variant, gives the new conversation the place its source held, keeping any groups that stood to the source's left <!-- claim:chat:rail-fork-inherits-source-slot -->
- The rail orders its groups by how each was started from inside the one to its left, root at the left, ending at the group currently focused <!-- claim:chat:rail-ancestry-order -->
- Exactly one group is focused - the one the reader writes into, the only one that splits into transcript plus right column, and the only one with its own message box and control bar <!-- claim:chat:rail-one-focused-group -->
- Every group other than the focused one shows one column: its conversation in its own Focused or Everything view - Everything when it picked Terminal or Work - with compaction and interrupt markers inline, no divider, no right column, no control bar, no message box <!-- claim:chat:rail-ancestor-single-column -->
- A group other than the focused one shows the conversation as it stood when the rail last read it; it takes up where it left off, with the newest messages there, once it becomes the focused group <!-- claim:chat:rail-ancestor-catches-up-on-focus -->
- Drilling into a child pushes a new group to the rail's right and gives it focus; the group the reader drilled from stays on the rail, now reading <!-- claim:chat:rail-drill-pushes-group -->
- Focusing a group already on the rail brings the group that was focused a moment ago along for the ride, reading, to its side <!-- claim:chat:rail-focus-move-keeps-neighbor -->
- Drilling into a different child after focusing an earlier group ends the rail at that group and pushes the new child next; the branch left behind is no longer on the rail <!-- claim:chat:rail-drill-elsewhere-truncates -->
- Beyond a certain depth, the rail shows the root and the nearest groups to focus; the ones between them are reachable from the session header path (§2.6) instead of taking up rail width <!-- claim:chat:rail-depth-cap -->
- Each group other than the focused one holds a fixed column width; the focused group takes what remains and never drops below one transcript column - a group scrolls off the rail's edge before the focused group's transcript is squeezed at all (computed-width comparison; proven visually, not functionally) <!-- skip:claim:chat:rail-ancestor-fixed-width -->
- Drilling deep enough that the groups no longer fit scrolls the rail sideways and brings the focused group fully into view (scroll-position geometry; proven visually, not functionally) <!-- skip:claim:chat:rail-scrolls-into-view -->
- Opening a side panel, or narrowing the window, until the focused group cannot hold both its columns collapses its split before its transcript would go below one column's width; its right-view toggle still reads as on (computed-width threshold, the same class as the existing split-collapse claim; proven visually, not functionally) <!-- skip:claim:chat:rail-focused-floor-before-split -->
- The message box sits inside the focused group, under its columns; a group other than the focused one has none <!-- claim:chat:rail-message-box-in-focused-group -->
- The message box moves with focus, taking keyboard focus with it; each group keeps its own draft, history, and queue independently <!-- claim:chat:rail-message-box-follows-focus -->
- Sending reaches the focused group's session alone; no other group's conversation changes <!-- claim:chat:rail-send-scoped-to-focused -->
- Scrolling one group moves only that group; its neighbors hold their own position (two independent scroll-position comparisons; proven visually, not functionally) <!-- skip:claim:chat:rail-scroll-independent -->
- Each group remembers its own divider position and its own right-view choice, independent of every other group on the rail <!-- claim:chat:rail-per-group-split-memory -->
- The rail survives a reload - the same groups return, in the same order, with the same one focused <!-- claim:chat:rail-restores-on-reload -->
- A branch left behind by focusing an earlier group belongs to the browser tab it happened in; a second browser tab open on the same tree keeps its own rail, and neither tab's left-behind branch appears in the other <!-- claim:chat:rail-tail-per-browser-tab -->
- Opening a child session's own URL directly gives that session focus, with its ancestors on the rail beside it and nothing to its other side <!-- claim:chat:rail-direct-child-link -->
- The moment a child session's URL opens, the focused group is already there; its ancestors fill in beside it as they arrive, without moving the focused group once it has painted <!-- claim:chat:rail-ancestors-arrive-after-focused -->
- A group whose own session has stopped keeps its place on the rail and keeps reading; only its status dot in the session header path changes <!-- claim:chat:rail-stopped-group-keeps-place -->
- A group whose conversation cannot be read keeps its place on the rail and states that it is unavailable, rather than being dropped from the chain <!-- claim:chat:rail-unreadable-group-keeps-place -->
- A group appears on the rail regardless of whether the Sessions panel would list it on its own <!-- claim:chat:rail-includes-quiet-groups -->
- Among groups that began inside another conversation, the rail draws no distinction between how each came to exist - a reply answered on its own, promoted onto the rail (§3.17), reads like any other <!-- claim:chat:rail-promoted-thread-is-ordinary-group -->
- Stopping the focused group's session returns focus to the group it descended from; stopping the root group's session returns to the welcome screen <!-- claim:chat:rail-stop-focused-returns-to-parent -->
- Stopping a group other than the focused one, from its entry in the session header path, leaves the focused group running <!-- claim:chat:rail-stop-ancestor-leaves-focused-running -->
- No rail on a phone or tablet - one session at a time, as elsewhere on touch <!-- claim:chat:rail-no-touch -->

### 3.20 Added Text

- What the agent receives when a Stop hook holds its turn, and the note Claude Code adds when the agent's next reply carries no text, do not appear as messages in the conversation <!-- claim:chat:added-text-hidden -->
- The block such text follows shows a small muted triangle in its bottom-right corner, pointing to the bottom right; hovering it names where the text came from, such as `Stop hook` or `Claude Code`. The triangle never covers the block's text <!-- claim:chat:added-text-corner -->
- Clicking the triangle opens a box under the block, styled like an open details block, listing each piece of text with its source, as the agent received it; clicking again closes it <!-- claim:chat:added-text-box -->
- Text that arrives before anything else in a turn hangs on the user's message; text that follows a block the conversation does not show hangs on the nearest earlier block it does <!-- claim:chat:added-text-anchor -->
- Copying a turn, its answer or a message part, and quoting a selection, leave added text out <!-- claim:chat:added-text-excluded -->

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
- Hovering a block's offset shows the date and time it measures to <!-- claim:tool:timing-hover -->

### 4.2 Tool-Specific Formatting

| Tool            | Header                         | Summary                                  |
|-----------------|--------------------------------|------------------------------------------|
| Read            | `Read(filename)`               | Line count; warning if present           | <!-- claim:tool:read -->
| Edit            | `Edit(filename)`               | Diff summary ("+N, -M")                  | <!-- claim:tool:edit -->
| Write           | `Write(filename)`              | "Wrote N lines"                          | <!-- claim:tool:write -->
| Bash            | `Bash(description)`, falling back to `Bash(command)` when none was given | Line count, output preview (single-line), or "Done" (empty) | <!-- claim:tool:bash -->
| Grep            | `Grep(pattern)` or `Grep(pattern:path)` | Context-aware count (see below)          | <!-- claim:tool:grep -->
| Glob            | `Glob(pattern)`                | File count                               | <!-- claim:tool:glob -->
| Task            | `Task(description)`            | Status/first line                        | <!-- claim:tool:task -->
| Skill           | `Skill(name)`                  | "Launching skill: {name}"                | <!-- claim:tool:skill -->
| WebFetch        | `WebFetch(url)`                | First line of result                     | <!-- claim:tool:webfetch -->
| WebSearch       | `WebSearch(query)`             | First line of result                     | <!-- claim:tool:websearch -->
| TodoWrite       | `TodoWrite`                    | Diff counts: `● 2 ◐ 1 ○ 3 ✕ 1`           | <!-- claim:tool:todowrite -->
| MCPSearch       | `MCPSearch`                    | "Tool loaded" or "Found N tools"         | <!-- claim:tool:mcpsearch -->
| AskUserQuestion (once answered) | `AskUserQuestion(N questions)` | Question count           | <!-- claim:tool:askuser -->
| ExitPlanMode    | `ExitPlanMode(title)`          | Plan title (first heading, truncated if long) | <!-- claim:tool:exitplan -->
| TaskOutput      | `TaskOutput(task_id)`          | Status: Running/Completed/Failed/Timeout/Killed | <!-- claim:tool:taskoutput -->

**Skill Output:**

- A skill's text displays only inside its Skill block's expandable content <!-- claim:tool:skill-content-folds -->
- A skill's text stays with its own Skill block whatever arrives between the call and the text: other tools' calls and results, a rate-limit update <!-- claim:tool:skill-content-tool-result-intervening -->
- A skill that loads again in the same session shows that load's text inside that load's Skill block; the agent's one-line note that the skill was loaded before stays hidden <!-- claim:tool:skill-content-reload -->
- Reopening a stored session, however old, shows each skill's text the same way <!-- claim:tool:skill-content-reopen -->

**MCP Output:**

- A result made of several pieces shows every piece, in the order the result lists them <!-- claim:tool:mcp-output-order -->
- Prose renders as text; markdown renders as markdown - headings, lists, code fences <!-- claim:tool:mcp-output-text -->
- A piece that is itself a JSON document still shows as a JSON tree <!-- claim:tool:mcp-output-json -->
- An image shows as an image <!-- claim:tool:mcp-output-image -->
- A linked resource shows its name, its description and its URI <!-- claim:tool:mcp-output-link -->
- Content the app cannot display (audio, a binary resource) is named by its media type rather than shown as an empty box <!-- claim:tool:mcp-output-unviewable -->

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
- Alt+Click a highlighted path to open it in your editor instead of copying it <!-- claim:tool:path-alt-click-opens-editor -->
- With no editor configured, Alt+Click copies the path like an ordinary click <!-- claim:tool:path-alt-click-fallback -->
- File tool blocks offer a control that opens the file in your editor <!-- claim:tool:file-open-in-editor -->
- With no editor configured, no such control appears <!-- claim:tool:file-open-in-editor-unconfigured -->
- The control opens the file at the read's starting line when one is known <!-- claim:tool:file-open-in-editor-line -->

### 4.3 Interactive Tools

**AskUserQuestion:**

- Renders form with single or multi-select options <!-- claim:tool:askuser-form -->
- Always includes "Other" with text input <!-- claim:tool:askuser-other -->
- "Other" textarea auto-resizes as user types (like main chat input) <!-- claim:tool:askuser-other-autoresize -->
- No placeholder hint text in "Other" textarea <!-- claim:tool:askuser-no-placeholder -->
- Submit button disabled until user makes a selection <!-- claim:tool:askuser-submit-disabled -->
- Selecting "Other" option auto-focuses the text input <!-- claim:tool:askuser-other-focus -->
- Submit sends answer <!-- claim:tool:askuser-submit -->
- Alongside your choices you can type a message; sending delivers both as one turn, together with any attachments and any inline replies you have waiting <!-- claim:tool:askuser-note -->
- User's selection shown immediately after submit <!-- claim:tool:askuser-optimistic -->
- The answer and the message it was sent with are both shown in the transcript <!-- claim:tool:askuser-note-shown -->
- The message sent with an answer appears in the same bubble as a message sent on its own <!-- claim:tool:askuser-note-bubble -->
- After submit, highlight what was answered (selected option or custom text) <!-- claim:tool:askuser-highlight-answer -->
- Tool block collapses after submitting response <!-- claim:tool:askuser-collapse-after-submit -->
- Q/A visual separation: visually distinguish questions from answers, separate pairs <!-- claim:tool:askuser-qa-separation -->
- Previously answered questions show read-only "Answered" display <!-- claim:tool:askuser-answered -->
- Form disabled when follow-up human message exists in conversation <!-- claim:tool:askuser-disable-after-reply -->
- While a question awaits an answer, only the form appears; no block header above it <!-- claim:tool:askuser-form-only -->
- Answered questions show no error styling, even when the question tool reported a failure <!-- claim:tool:askuser-answered-not-error -->
- With a choice made, sending from the message box submits the answer and the message together; with no choice made, sending leaves the question unanswered and delivers the message on its own <!-- claim:tool:askuser-disable-on-send -->
- A question awaiting an answer shows its form with no error styling, even when the question tool reported a failure <!-- claim:tool:askuser-live-form-not-error -->
- A question still waiting for an answer in a conversation shown read-only - a group read beside the rail's focused one, a reply box frozen after promotion, the card a reply promoted onto the rail shows - appears disabled, and choosing an option there does nothing <!-- claim:tool:askuser-read-only -->

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

- Answering a question or a plan with its Submit button, or clicking one of an agent's one-click replies, puts the cursor back in the message box of that conversation, where it last was, unless another field was given the cursor while the answer was sending; a question asked inside a reply box's own exchange puts it in that box's follow-up field instead <!-- claim:tool:answer-focus -->

### 4.4 Nested Tool Blocks

- Task tool can contain nested tool calls <!-- claim:tool:nested-task -->
- Displayed as indented tree with connectors <!-- claim:tool:nested-tree -->
- Auto-collapse when task completes <!-- claim:tool:nested-collapse -->
- The subagent's own prose appears in the Activity list too, interleaved with its calls in the order it happened, rendered as markdown the same way an assistant's prose renders in the transcript - no clamp, no per-entry collapse <!-- claim:tool:nested-prose -->

### 4.4.1 Realtime Nested Display

Nested tool calls in Task blocks display progressively in real-time: <!-- claim:tool:nested-realtime -->

| Event | Display |
|-------|---------|
| New nested tool call | Nested block appears with pending spinner | <!-- claim:tool:nested-tool-use -->
| Nested tool completes | Nested block updates with result summary | <!-- claim:tool:nested-tool-result -->
| Subagent narrates | Its prose appears in place, alongside the calls | <!-- claim:tool:nested-prose-realtime -->

**Behavior:**

- Task blocks collapsed by default during execution, the same as every other tool <!-- claim:tool:task-collapsed-default -->
- Once expanded, nested tools appear immediately as they stream in, not deferred until Task completion <!-- claim:tool:nested-immediate -->
- Pending nested tools show cyan pulsing bullet with spinner <!-- claim:tool:nested-pending-spinner -->
- Completed nested tools show green bullet with result summary <!-- claim:tool:nested-complete-green -->
- User can expand a running Task by hand to watch it live, and collapse it again <!-- claim:tool:task-expand-toggle -->
- A collapsed running Task's header shows a one-line activity feed: a status dot and title for the newest nested call, or the newest line of narration for prose <!-- claim:tool:task-activity-line -->
- The activity line always reflects the most recently arrived nested item, replacing whatever it showed before <!-- claim:tool:task-activity-follows-newest -->

**Collapsed Task during execution:**
```
◐ Task(description)          ● Bash(check pytest status)                 [▶]
```

**Expanded Task during execution:**
```
◐ Task(description)                                                      [▼]
  ● Read /src/file.py              <- completed
  └ Read 50 lines
  The file confirms it - trying the other module next.
  ◐ Grep "pattern" in /src         <- in progress
  └ 🔄
```

### 4.5 Expandable Content

- Click tool header to expand/collapse, wherever a header is shown <!-- claim:tool:expand-click -->
- Collapsible content based on content length <!-- claim:tool:expand-threshold -->
- Default collapsed: JSON, Read, Grep, Skill, WebSearch, WebFetch, TodoWrite, TaskOutput, Task, MCP results <!-- claim:tool:expand-default-collapsed -->
- A Bash command the app reads as changing nothing starts collapsed, the same as a file read, from the moment it appears - in its turn, in the work column, and inside a subagent's block. The app reads a command as changing nothing when it only moves between directories, lists, reads, searches or prints: it writes no file, not even one a tool keeps for itself such as the record `git status` updates; it reaches no network; it runs no program or script; and it sends output nowhere but `/dev/null` <!-- claim:tool:bash-read-only-collapsed -->
- A Bash command the app reads as writing a file, reaching the network or running a program or script, and one the app cannot read at all, shows expanded while it runs <!-- claim:tool:bash-changing-expanded -->
- Reading git history with `git log`, `git show` or `git blame`, sorting with `sort`, feeding a command a heredoc, and setting a variable whose name holds an uppercase letter each count as changing something; setting a variable whose name is all lowercase does not <!-- claim:tool:bash-changing-cases -->
- A command that changes nothing and fails still starts collapsed; its row shows the failure the way a failed file read's does <!-- claim:tool:bash-read-only-failure -->
- In a session recorded by an earlier version of the app, no Bash command starts collapsed for changing nothing <!-- claim:tool:bash-read-only-recorded -->
- When a Bash command finishes, what it did replaces what the app read in its text: a command that wrote no file, reached nothing and sent output nowhere but `/dev/null`, the terminal or a descriptor it was given collapses, in its turn, in the work column and inside a subagent's block <!-- claim:tool:bash-measured-folds -->
- A Bash command that wrote a file, even one it deleted again or kept only for itself, reached the network, or asked a service to act for it shows expanded once it finishes, whatever the app read in its text <!-- claim:tool:bash-measured-shows -->
- However little a Bash command prints, that alone never folds it: a command the app does not fold for changing nothing shows expanded once it finishes, even when it printed a single line or nothing at all, in its turn, in the work column and inside a subagent's block. Opened, it shows that line again beneath its command <!-- claim:tool:bash-short-output-shows -->
- Running a program is not itself a change once a command has finished: a command that only printed is folded away even where the app read it as running something. Reversing a file through a pipe keeps a file of its own and counts as a change; reversing the file by name does not. Looking up a user does not count <!-- claim:tool:bash-measured-cases -->
- A Bash command still running when its result comes back, such as one sent to the background, shows expanded if it has already changed something, and otherwise keeps what the app read in its text <!-- claim:tool:bash-measured-running -->
- Where this cannot be measured, every Bash command behaves as what the app read in its text says, and nothing in the interface mentions it <!-- claim:tool:bash-measured-unavailable -->
- Default expanded: ExitPlanMode; a question awaiting an answer shows its form immediately <!-- claim:tool:expand-default-expanded -->

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
- When the right column shows the work view, the compaction marker appears once in the transcript and once in the work column, at the corresponding point in each timeline, and each expands independently of the other <!-- claim:tool:compaction-both-columns -->


### 4.8 Tool Input Display

- Hover on tool header shows full input as tooltip, wherever a header is shown <!-- claim:tool:input-hover -->
- Bash tool: the command appears in the header (or its description, when given) and, expanded, in its own "Command" section above the output <!-- claim:tool:input-bash-dedup -->
- Bash header shows the description of what the command does, falling back to the command itself when none was given <!-- claim:tool:bash-header-description -->
- Expanding a Bash block shows the full command in its own section above the output <!-- claim:tool:bash-command-section -->
- A Bash block shows its command while the command is still running <!-- claim:tool:bash-command-while-running -->
- A Bash block's command is shown without line numbers <!-- claim:tool:bash-command-no-linenums -->
- A Bash command shows each command on its own line wherever the agent joined them with `;`; loop, `if`, `case` and grouped bodies sit on their own lines beneath their opening line, indented. The same layout shows in the block, in the work column and in the terminal column <!-- claim:tool:bash-command-layout -->
- A line of a command longer than about 120 characters breaks before each `&&`, `||` and `|` it holds, every continuation indented beneath it; shorter chains stay on one line <!-- claim:tool:bash-command-chain-break -->
- Laying out a command changes only its spacing and line breaks: every word is what ran, line breaks the agent wrote stay, and heredoc text shows exactly as sent <!-- claim:tool:bash-command-words-kept -->
- Copying a Bash command copies it exactly as the agent sent it <!-- claim:tool:bash-command-copy-as-sent -->
- A command that cannot be read as shell shows exactly as the agent sent it, as does a command an earlier version of the app recorded <!-- claim:tool:bash-command-unreadable -->
- Unhandled tools (no specialized formatter) show tool input as collapsible "Input" section in expanded content <!-- claim:tool:input-unhandled-section -->
- Input section rendered above tool output <!-- claim:tool:input-above-output -->
- Input section expanded by default when tool block is expanded <!-- claim:tool:input-default-expanded -->
- Input section visible while tool is pending (shows what was sent before result arrives) <!-- claim:tool:input-pending-visible -->
- Input section is omitted when the tool input is empty (`{}`) <!-- claim:tool:input-empty-hidden -->
- Handled tools (Read, Edit, Write, Bash, Grep, Glob, Task, etc.) use their specialized formatters and omit the generic input section <!-- claim:tool:input-handled-skip -->
- Unhandled tools wrap output in collapsible "Output" section (symmetric with "Input" section) <!-- claim:tool:output-unhandled-section -->
- A Bash block's command and its output are shown in the same fixed-width type as other code, on a single surface <!-- claim:tool:bash-code-surface -->
- A shell command appears in the terminal column while the terminal view is on, in the work column while the work view is on, as a block in its turn in Everything, and as a block in its turn in Focused unless it changes nothing <!-- claim:tool:bash-terminal-routing -->
- Every other tool call likewise appears in the work column while the work view is on, and as a block in its turn otherwise, unless Focused leaves it out <!-- claim:tool:work-view-tool-routing -->

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
- When the "Todos" panel would have nothing to show, the panel does not appear in the chat at all <!-- claim:tool:todos-block-empty-suppressed -->

- Task prompt expanded by default for running tasks; auto-collapses when task completes; past completed tasks show collapsed with truncated first-line preview <!-- claim:tool:task-prompt-collapsed -->
- Click prompt header to reveal full multi-line prompt text <!-- claim:tool:task-prompt-content -->

### 4.9.1 Lookups Details

- A turn's file reads, searches, and other read-only calls appear together in a single "Lookups" panel placed after the turn's last block <!-- claim:tool:lookups-block-grouped -->
- A Bash command that changes nothing is a lookup too: it joins the "Lookups" panel and counts as `Bash` in the panel's summary <!-- claim:tool:lookups-block-read-only-bash -->
- A single lookup in a turn appears as an ordinary block, in place <!-- claim:tool:lookups-block-threshold -->
- The "Lookups" panel uses the standard tool-block chrome: a header line showing the label `Lookups` and a summary line showing a count for each kind of call it holds; the panel opens collapsed and clicking the header reveals the row body <!-- claim:tool:lookups-block-collapsed -->
- Each row expands on its own, showing that call's output the same way it would as a standalone block <!-- claim:tool:lookups-block-rows -->
- Rows appear in the order the calls happened <!-- claim:tool:lookups-block-order -->
- A subagent's own lookups stay inside its Task block, not pulled into the turn's "Lookups" panel <!-- claim:tool:lookups-block-nested-excluded -->

### 4.9.2 Tool-Schema Search

- A tool-schema search is not shown in the conversation unless it failed <!-- claim:tool:toolsearch-hidden -->

### 4.10 Task Block Behavior

- Click anywhere on Task header to expand/collapse <!-- claim:tool:task-click-expand -->
- Loading spinner vertically aligned with text <!-- claim:tool:task-spinner-align -->
- A hand toggle on a running Task, expanded or collapsed, survives its next nested event arriving <!-- claim:tool:task-toggle-sticky -->

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

System reminders the agent receives are kept out of the text and output they arrive in, and shown through the added-text triangle of §3.20 <!-- claim:tool:reminder -->

- No reminder text appears in a tool's output or in a message <!-- claim:tool:reminder-strip -->
- Each unique reminder is its own entry in the box, labelled `System reminder` <!-- claim:tool:reminder-separate -->
- A tool row whose result carries a reminder shows the triangle whether the row is folded or open; the box stays closed until the triangle is clicked <!-- claim:tool:reminder-collapsed -->
- Identical reminders on one block show once, with a ×N count <!-- claim:tool:reminder-dedup -->
- A reminder that arrives as its own message hangs on the block before it, as other added text does <!-- claim:tool:reminder-standalone -->
- Applies to all tool results and message content <!-- claim:tool:reminder-scope -->

### 4.13 Tool Error Display

- Error message shown in red subtitle line <!-- claim:tool:error-subtitle -->
- When full error fits in subtitle, suppress duplicate code block below <!-- claim:tool:error-no-duplicate -->
- A Bash command that fails shows a red bullet and a red summary line, collapsed or expanded, in its turn and in the work column, whatever the command does <!-- claim:tool:bash-failure-marked -->

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
- Each nested call and each line of narration appears once, however many times the session recorded it - including after a reload or a restart mid-task <!-- claim:tool:bgtask-nested-once -->
- The subagent's own prose appears in the Activity list too, interleaved with its calls, the same as a foreground task's <!-- claim:tool:bgtask-nested-prose -->
- While pending, a background task's header shows the same one-line activity feed as a foreground task's <!-- claim:tool:bgtask-activity-line -->

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
- Each row: status dot (colours below), ID (first 8 chars) + name (if set), time ago, turns, cost <!-- claim:panel-session:row-content --> <!-- claim:panel-session:container-dot -->
- A row for a session whose runtime is known also shows that runtime's name <!-- claim:panel-session:runtime-badge -->
- Resume button (Play icon) shows a spinner from click until the tab switch / new browser tab paints; disabled while spinning <!-- claim:panel-session:resume-spinner -->
- Hovering turns / cost / each timestamp segment reveals informative tooltips: "Turns — N", "API cost this session — $X.XX", "Started — …", "Last active — …" <!-- claim:panel-session:meta-tooltips -->
- Clicking session ID copies full session directory path to clipboard; shows "Copied!" briefly <!-- claim:panel-session:copy-id -->
- Preview of first and last messages (last prefixed with "...") <!-- claim:panel-session:preview -->
- Hovering a message preview shows up to its first 300 characters, ending in ... when cut <!-- claim:panel-session:preview-tooltip -->
- Auto-refresh when sessions change <!-- claim:panel-session:auto-refresh -->
- Auto-refresh follows only the shown workspace: changes to sessions and containers in other workspaces leave the list as it is <!-- claim:panel-session:auto-refresh-scoped -->
- The list stays responsive however many sessions the workspace holds: scrolling, refreshing and switching filters take the same time with thousands of sessions as with a few <!-- claim:panel-session:scales -->
- A session whose container has stopped shows as stopped (gray dot), never stuck on "stopping" <!-- claim:panel-session:stopped-shows-stopped -->
- While a running session needs you, its row's dot is dark orange and the line that previews its last message shows the agent's one-line reason instead; answering the session returns both to normal, and stopping it shows the stopping color first <!-- claim:panel-session:needs-you -->
- A session that stops while still needing you shows as stopped, with its last message and no reason <!-- claim:panel-session:needs-you-running-only -->
- A collapsed session's dot is dark orange while a session beneath it needs you <!-- claim:panel-session:needs-you-collapsed -->
- While a session's agent is working on a message, its row's status dot shows purple and holds still, whether or not that session is the one on screen <!-- claim:panel-session:working-dot -->
- Once the agent has finished but a command or task it started in the background is still going, the dot shows a dimmer purple; once nothing is left going, it shows green again <!-- claim:panel-session:working-dot-background -->
- A session still working after asking for you shows working until it finishes, then shows that it needs you, even while something it started in the background is still going; a stopping session shows the stopping color whatever its agent was doing; a session without a running container never shows working <!-- claim:panel-session:working-dot-precedence -->
- A row whose forks are folded shows working when a fork beneath it is working <!-- claim:panel-session:working-dot-folded -->
- Current session row highlighted <!-- claim:panel-session:current-highlight -->
- Loading state: "Loading..." <!-- claim:panel-session:loading -->
- Error state: "Failed to load sessions" with Retry button <!-- claim:panel-session:error -->
- Empty state: "No sessions yet" <!-- claim:panel-session:empty -->
- Sessions with 0 turns hidden from list (except active session) <!-- claim:panel-session:hide-empty -->
- Three-tier sort: pinned first, then unpinned-with-container by max descendant timestamp, then unpinned-without-container by max descendant timestamp <!-- claim:panel-session:sort-tiers -->
- Fork activity bubbles up via max timestamp across all descendants <!-- claim:panel-session:fork-sort-key -->
- After "Fork here", the running indicator moves from the original session to the new one; the stop button hides on the original session <!-- claim:panel-session:fork-here-running-indicator -->
- Starting a side conversation leaves the original session's running indicator exactly where it was; no row is added for the side conversation <!-- claim:panel-session:fork-thread-running-indicator -->
- Active fork auto-expands ancestor chain in session tree; pinned active session collapses all <!-- claim:panel-session:auto-expand-ancestors -->
- Hover on truncated session name shows full name in tooltip <!-- claim:panel-session:tooltip-truncated -->
- Six filters sit on the panel's button row, each an icon with a count badge and no visible name; hovering one shows its name in a tooltip: Conversations, Named, Pinned, Threads, Subsessions, All. Hidden while the search box is open <!-- claim:panel-session:filters -->
- When the filters do not all fit, the row scrolls sideways instead of clipping - by wheel, trackpad, touch, or drag - with no scrollbar visible at rest or while scrolling <!-- claim:panel-session:filters-scroll -->
- A chevron appears on whichever side has more filters beyond it, and is gone from a side once scrolled fully to that end <!-- claim:panel-session:filters-chevron -->
- The chosen filter always ends up fully in view, whether it was reached by scrolling and clicking or by the auto-switch to All <!-- claim:panel-session:filter-scrolled-into-view -->
- Conversations (default): the sessions the reader started, with forks nested underneath <!-- claim:panel-session:filter-default -->
- Named: only sessions given a name by hand <!-- claim:panel-session:filter-named -->
- Pinned: only pinned sessions <!-- claim:panel-session:filter-pinned -->
- Threads: side conversations opened from a quote popup, each showing what conversation it came from <!-- claim:panel-session:filter-threads -->
- Subsessions: sessions started by an agent on another agent's behalf, each showing what session started it <!-- claim:panel-session:filter-subsessions -->
- All: every session, of every kind, in one tree <!-- claim:panel-session:filter-all -->
- Each filter's count matches the number of rows it lists <!-- claim:panel-session:filter-count -->
- Choosing a filter with nothing in it shows a message saying so, not a blank area <!-- claim:panel-session:filter-empty -->
- Opening a session the chosen filter does not list shows All until a session it does list is opened; nothing else moves the filter, including a session ceasing to be listed after the filter was chosen <!-- claim:panel-session:filter-auto-switch -->
- The filter the reader chose survives a reload; a move to All the panel made for itself is not remembered <!-- claim:panel-session:filter-persist -->
- A search control sits between the new-session chevron and refresh; clicking it opens a box across the header row and puts focus in it <!-- claim:panel-session:search-control -->
- The search box matches a session by name or by id, case-insensitively, whether typed or pasted in full <!-- claim:panel-session:search-match -->
- A search is found whether or not the chosen filter would have listed it - it spans every session <!-- claim:panel-session:search-spans-filters -->
- Search results are a flat list: no session is nested under another, no unmatched parent appears as context, and a pinned fork that would otherwise appear twice appears once <!-- claim:panel-session:search-flat -->
- A search with no matches shows a message saying so, not a blank area <!-- claim:panel-session:search-empty -->
- Closing the search box - by Escape, or by clearing it and clicking away - restores the filter icons and the filter chosen before searching, unchanged <!-- claim:panel-session:search-close -->
- The search box is not remembered across a reload; it always opens closed <!-- claim:panel-session:search-persist -->
- A session the user has not named is given a short title of about five words once its third message is sent, and the title is written again from the longer conversation when its sixth and its tenth messages are sent; it never changes after the tenth, a session with fewer than three messages stays unnamed, and a title that cannot be written leaves the previous one in place - or the session unnamed - with nothing shown <!-- claim:panel-session:auto-name -->
- A title given automatically shows in italics and dimmed wherever a session name appears - the session list, the header, bookmarks, the containers panel, the mobile top bar - and as the session name in the browser tab title; a name given by hand shows normally and always takes its place <!-- claim:panel-session:auto-name-style -->
- Renaming a session by hand replaces its automatic title, and the session then appears under Named <!-- claim:panel-session:auto-name-rename -->

### 5.2 Actions

| Action | Behavior                                                     |
|--------|--------------------------------------------------------------|
| Resume | Load session, reconnect, focus chat; progress bar during hydration | <!-- claim:panel-session:resume -->
| New    | Create blank session, reconnect, focus chat              | <!-- claim:panel-session:new -->
| Rename | Inline edit field; Save (✓) and Cancel (✕) buttons; clicking away cancels | <!-- claim:panel-session:rename -->
| Kill   | Stop session; spinner and disabled while stopping; visible only when session has a container | <!-- claim:panel-session:kill-container -->

- A new session can be renamed before its first message; the name is kept, and a named session stays in the list even if no message is ever sent <!-- claim:panel-session:rename-before-first-message -->

**Panel Buttons:**

- New (+) button: Creates new session (in panel header); Alt+Click or middle-click opens in new browser tab <!-- claim:panel-session:new-button -->
- Refresh button: Reloads session list (in panel header) <!-- claim:panel-session:refresh-button -->
- Edit button: Revealed on row hover for rename action <!-- claim:panel-session:edit-button -->
- Kill button: Stop icon, revealed on row hover when session has a container; red on hover; spinner and disabled while stopping <!-- claim:panel-session:kill-button -->
- A side conversation's row offers no Kill button, even while it is answering — stopping it ends only that conversation, never the one it came from <!-- claim:panel-session:kill-thread -->

### 5.3 Display Format

- Time: "just now" (<1m), "Xm ago", "Xh ago", "Xd ago" (<7d), then full date <!-- claim:panel-session:time-format -->
- A row's time keeps up while its session sits idle: "just now" turns into "1m ago", "2m ago" and onward as time passes, with no other activity needed <!-- claim:panel-session:time-live -->
- Time range: "started – updated" when different <!-- claim:panel-session:time-range -->
- Cost: USD with 2 decimal places (`$X.XX`), `$X.XXK` for ≥$1K; em dash if null <!-- claim:panel-session:cost-format -->
- A session's cost counts each turn once: resuming, restarting or forking a session adds only what its new turns spend <!-- claim:panel-session:cost-counted-once -->
- Turns: "X turns", "—" if null <!-- claim:panel-session:turns-format -->
- Messages: truncated with ellipsis <!-- claim:panel-session:message-truncate -->

### 5.4 Pinned Sessions

- Pin button left of resume icon <!-- claim:panel-session:pin-button -->
- Orange when pinned, muted when unpinned <!-- claim:panel-session:pin-color -->
- Pinned sessions sorted to top, maintain original order within pinned group <!-- claim:panel-session:pin-order -->
- Pinned state persists across sessions <!-- claim:panel-session:pin-storage -->
- Pinning or unpinning a session shows at once in another open tab of the same browser <!-- claim:panel-session:pin-cross-tab -->
- A pinned session keeps what the app remembers for it - its panel layout, its minimap toggle - however long ago it was last used <!-- claim:panel-session:pin-keeps-settings -->
- Pinning or unpinning a session stays as clicked when the sessions list refreshes at the same moment <!-- claim:panel-session:pin-survives-refresh -->

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
- A link to a session, board or send-link in another workspace switches to that workspace and opens what it names <!-- claim:routing:cross-workspace-link -->
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
- Session status dot: the same colors and states as a Sessions panel row (§5.1) <!-- claim:board:card-session-dot -->
- The status text names the state the dot shows: working, waiting, needs you, running, stopping or stopped <!-- claim:board:card-session-label -->
- Click card to open detail overlay <!-- claim:board:card-click-detail -->
- Ctrl+click / Cmd+click to toggle multi-select <!-- claim:board:card-multi-select -->

### 6.5 Drag and Drop

- Drag card between columns to move ticket <!-- claim:board:drag-column -->
- A ticket dragged into a column that already holds a ticket file of the same name stays where it was, and an error explains why <!-- claim:board:move-collision-refused -->
- A ticket whose file is not in the folder its column keeps tickets in stays where it was when dragged to a column with a different folder, and an error says so <!-- claim:board:move-outside-folder-refused -->
- A column's folder is a directory under the board's own folder, however it is written; a card moves between two columns naming the same directory without its file moving <!-- claim:board:folder-under-board -->
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
- A ticket dragged from a closed column back into an active one is assigned under its new location, and its session's opening messages name that location <!-- claim:board:reopen-assign -->

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

- An open board shows changes made to its board file within a few seconds, whether an agent, another program or another browser tab made them <!-- claim:board:sse-update -->
- A ticket card's title and an open ticket's detail show edits made to the ticket file within a few seconds <!-- claim:board:ticket-file-update -->
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
- Items stashed in one session never appear in or are saved into another; an item stashed before the session's stash has loaded is kept above its saved items <!-- claim:panel-stash:session-scoped -->
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

## 8. Todos Panel

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
- Tasks icon shows count of currently-running background subagents and commands in the default Todos style; hidden when none active <!-- claim:panel-task:badge -->
- MCP icon shows count of MCP servers in the `failed` state in a red (danger) variant; hidden when no failures <!-- claim:panel-mcp:badge -->

---

## 9. Help Panel

Displays keyboard shortcuts reference tables. <!-- claim:panel-help:shortcuts-table -->

---

## 10. Footer

### 10.1 DEV Mode Indicator

- In development mode, "DEV" label appears at the leftmost position of the footer <!-- claim:footer:dev-indicator -->

### 10.2 Status Indicators

| Element        | States                                                                                   |
|----------------|------------------------------------------------------------------------------------------|
| Connection dot | Green (connected), Amber (connecting/stopping), Red (error/reconnecting)                | <!-- claim:footer:connection-dot -->
| Status text    | "Ready", "Submitting...", "Working...", "Waiting...", "Stopping...", "Stopped", "Connecting", "Resuming...", "Forking...", "Creating session...", "Opening board...", "Opening workspace...", "Reconnecting...", "Disconnected", error | <!-- claim:footer:status-text -->
| Elapsed timer  | "(Ns)" suffix on Submitting/Working, counts seconds since response started | <!-- claim:footer:elapsed-timer -->
| Interrupt hint | "Ctrl+. to stop" (when working or submitting)                                            | <!-- claim:footer:interrupt-hint -->
| Loading hint | "Wait for the session to load" for a few seconds after Enter or Alt+Enter is pressed while a session is loading | <!-- claim:footer:loading-hint -->

- Status reads "Waiting..." while the session waits on background work, with no elapsed timer <!-- claim:footer:status-waiting-background -->

**Status Dot Animations:**

- Working: Color-cycling animation (blue -> purple -> magenta)
- Stopping: Amber color with pulsing glow animation
- Reconnecting: Red dot, "Reconnecting..." with animated dots; retries indefinitely until restored <!-- claim:footer:reconnecting -->

**Silence Detection:** <!-- claim:footer:silence-detection -->

- After 5 seconds without server events, the status dot dims <!-- claim:footer:silence-threshold -->
- The dimmed dot is muted gray and still; the status text keeps reading "Working..." at full strength, with its timer <!-- claim:footer:silence-dim -->
- The dot resumes its working animation immediately when new events arrive <!-- claim:footer:silence-recovery -->

### 10.3 Session Stats

| Stat            | Format                                    | Tooltip                        |
|-----------------|-------------------------------------------|--------------------------------|
| Workspace       | Directory name only; visible immediately on page load, before session initialization | "Workspace — /path/..." | <!-- claim:footer:workspace -->
| Turns           | Integer count                             | "Turns — N"                    | <!-- claim:footer:turns -->
| Cost            | `$X.XX` (2 decimals), defaults to `$0.00` | "API cost this session — $X.XX" | <!-- claim:footer:cost -->
| Duration        | `H:MM:SS` (updates periodically while responding) | "Time Claude spent responding — H:MM:SS" | <!-- claim:footer:duration -->
| Context         | Token count + percentage bar (max 200K); exponential color gradient blue→yellow→orange; appears only when the current runtime reports token usage | "Context — X / Y tokens" | <!-- claim:footer:context --> <!-- claim:context-usage-bar:capability-gated -->
| Runtime         | Display name of the active runtime (e.g., "Claude") | "Runtime — name"               | <!-- claim:runtime:identity-pill -->
| Bundle          | Name of the session bundle the session started under, with a dot when a value it set has changed since; absent for a session started under none; opens nothing when clicked (§21.10) | "Bundle — name" and what it set | <!-- claim:bundle:pill -->
| Model           | Model name + chevron, "—" if null; clickable to open model picker | "Model — name"                 | <!-- claim:footer:model -->
| Effort          | Effort level name + chevron; clickable to open effort picker | "Effort — level"               | <!-- claim:footer:effort -->
| Permission mode | Permission mode label + chevron; clickable to open mode picker | "Permission mode — label"      | <!-- claim:footer:permission-mode -->
| Session ID      | First fragment (before the first "-"); full id stays in the tooltip / copy | "Session directory — /path/..." | <!-- claim:footer:session-id -->
| Runtime ID      | 8-char prefix; "—" when no container; clicking copies the full id; transitions to "—" immediately when the container stops | "Container — full-id" | <!-- claim:footer:runtime-id -->

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
- Never shows or applies another session's setting; a toggle made while the setting loads stands <!-- claim:footer:notifications-session-scoped -->

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
- A model, permission mode or effort level the agent does not accept, picked on an open session, on the welcome screen or while a session opens, shows "Failed to apply model", "Failed to apply permission mode" or "Failed to apply effort level" in the footer, and the picker then shows the value the session runs at <!-- claim:footer:refused-pick-reported -->
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
- The agent answers the next message at the level picked, in every session - side conversations and replies promoted onto the rail included - and stays at it across model switches, reloads and resumes (needs a live agent; proven by the runtime unit tests and the live repro) <!-- skip:claim:footer:effort-picker-applies -->

### 10.10 Plan Limit Warnings

An item per usage window appears in the footer, immediately left of the workspace name, only while that window is being approached or has been reached: <!-- claim:footer:rate-limit -->

- Position: immediately after the status indicator, before the workspace name; each item carries its own separator, so multiple items and the workspace name each stay visually distinct <!-- claim:footer:rate-limit-position -->
- Two windows: "Session" and "Weekly"; when both are being approached at once, Session appears first, then Weekly <!-- claim:footer:rate-limit-order -->
- Reads "Session <n>%" or "Weekly <n>%" while a percentage is known <!-- claim:footer:rate-limit-percentage -->
- Tinted from amber toward red as the percentage climbs; solid red once at or past the danger threshold, however much higher it climbs <!-- claim:footer:rate-limit-color -->
- Once a window is fully reached, its item reads "Session limit reached" or "Weekly limit reached" in red, with no percentage <!-- claim:footer:rate-limit-reached -->
- Hovering an item shows which window it is, the percentage (when known), and when it resets <!-- claim:footer:rate-limit-tooltip -->
- An item disappears on its own once its window resets or usage falls back to normal, and its separator disappears with it <!-- claim:footer:rate-limit-clears -->
- An item belongs to the workspace it appeared in: it stays visible after switching sessions or reloading the page within that workspace, and clears once a new session in that workspace reports the window back to normal <!-- claim:footer:rate-limit-persistence -->
- Nothing appears here before any usage information is known <!-- claim:footer:rate-limit-unknown -->

---

## 11. Error Handling

### 11.1 Error Display

| Error Type | Display                            |
|------------|------------------------------------|
| API error  | Footer transient message (4s)      | <!-- claim:error:api -->
| Connection error | Connection status + auto-reconnect | <!-- claim:error:sse -->
| Turn error | Red border on turn                 | <!-- claim:error:turn -->
| Runtime failure mid-message | Reported in the turn with the reason, and the working indication stops | <!-- claim:error:runtime-failure -->
| Agent connection ends mid-message | Reported in the turn as "The agent's connection ended before it answered", and the working indication stops | <!-- claim:error:stream-lost -->
| Tool error | Error styling in tool block        | <!-- claim:error:tool -->
| Interrupt  | Yellow border on interrupted turn, and on its last work-column block while the work view is on | <!-- claim:error:interrupt -->


**Interrupt Visualization:** <!-- claim:chat:interrupt-visual -->

- User interrupts (Ctrl+. or stop button) show visual indication <!-- claim:chat:interrupt-border -->
- Interrupted turn shows yellow left border <!-- claim:chat:interrupt-range -->
- Stopping the agent while it follows up on a background agent's result marks that turn interrupted <!-- claim:chat:interrupt-follow-up -->
- While the work view is on, an interrupted turn's last work-column tool block carries the same yellow left border, only when that block is the turn's trailing block; a turn interrupted after prose, or with no tool calls at all, marks no work-column block - the transcript's own border carries those cases <!-- claim:chat:interrupt-work-panel-block -->
- Internal interrupt confirmation not shown as user bubble <!-- claim:chat:interrupt-ack-hidden -->

### 11.2 Recovery

- Network errors trigger automatic reconnection <!-- claim:error:auto-reconnect -->
- Intentional session close transitions cleanly to disconnected state <!-- claim:error:graceful-disconnect -->
- User can manually reconnect via reload button <!-- claim:error:manual-reconnect -->
- Session state preserved across reconnects <!-- claim:error:preserve-state -->
- A conversation reads the same after a connection restores as it did before it dropped, with nothing repeated <!-- claim:error:reconnect-no-repeat -->
- Error state auto-clears after 4 seconds <!-- claim:error:state-clear -->
- "Stopped" state clears automatically after a short delay once the result event arrives <!-- claim:error:state-stopped-clear -->
- All live panels show "Resuming..." during replay <!-- claim:error:resuming-panels -->
- Session automatically recovers after a service restart; shows "Session reconnect failed" on failure <!-- claim:error:daemon-restart-recovery -->
- When the service comes back from a restart running a different version of claudebox than the one the page was opened with, the page reloads itself onto the same session or board; unsent text, inline replies and queued messages are kept <!-- claim:error:reload-on-new-version -->

### 11.3 Render Failure Containment

- When part of the app stops responding, that part shows an error state with a retry control, and the rest of the app keeps working <!-- claim:error:render-containment -->
- A tool call whose input cannot be read shows as an unreadable call in place, and the conversation around it keeps working <!-- claim:error:tool-block-containment -->

---

## 12. Performance Requirements

### 12.1 Responsiveness

| Action                | Expectation           |
|-----------------------|-----------------------|
| Keystroke in textarea | Immediate             |
| Panel toggle          | Instant feedback      |
| New message display   | Near-instant          |
| Scroll                | Smooth, no jank       |

---

## 13. Notifications

### 13.1 Desktop Notifications

Browser notification when response completes: <!-- claim:notify:desktop -->

- Trigger: the session finishes - no response in flight and no background work running - AND tab not visible AND notifications enabled <!-- claim:notify:desktop-trigger -->
- Title: matches browser tab title <!-- claim:notify:desktop-title -->
- Body: first ~50 chars of assistant message (not thinking block) <!-- claim:notify:desktop-body -->
- Click action: focus claudebox tab <!-- claim:notify:desktop-click -->
- Requires browser permission <!-- claim:notify:desktop-permission -->
- Do NOT notify on session resume <!-- claim:notify:desktop-no-resume -->

### 13.2 Sound Alerts

Audio notification on completion: <!-- claim:notify:sound -->

- Trigger: the session finishes AND tab not visible AND sound enabled <!-- claim:notify:sound-trigger -->
- Sound: single chime (same for success/error) <!-- claim:notify:sound-type -->
- Volume: quiet (not full volume) <!-- claim:notify:sound-volume -->
- Default: disabled (opt-in via footer toggle) <!-- claim:notify:sound-default -->

### 13.3 Favicon Indicator

The favicon shows the state of the tab's session: <!-- claim:notify:favicon -->

- Show the arc while Claude is responding <!-- claim:notify:favicon-processing -->
- Show the arc dimmed while the session waits on background work <!-- claim:notify:favicon-waiting -->
- The favicon is still - it changes only when the session's state changes <!-- claim:notify:favicon-static -->
- Change to notification variant when the session finishes - no response in flight and no background work running <!-- claim:notify:favicon-change -->
- Restore normal favicon on tab focus <!-- claim:notify:favicon-restore -->
- Show a red C-shape while the session needs you, whether or not the tab is focused <!-- claim:notify:favicon-needs-you -->
- The red C-shape stays when the tab is focused and clears when you send a message or answer in the session <!-- claim:notify:favicon-needs-you-clears -->
- While Claude is responding the arc shows; the red C-shape appears once the response ends <!-- claim:notify:favicon-needs-you-after-turn -->
- Circular background tinted in the workspace accent color fills the favicon (inscribed inside a small transparent margin) when a workspace color is set; the C-shape appears in white on top <!-- claim:notify:favicon-workspace-badge -->
- Badge fills the favicon as a centered circle inscribed inside a small transparent margin <!-- skip:claim:notify:favicon-workspace-badge-shape -->
- Badge fill color is a brightened version of the workspace accent color <!-- claim:notify:favicon-workspace-badge-color -->
- No badge appears when no workspace color is set <!-- claim:notify:favicon-workspace-badge-absent -->
- Badge background appears at reduced opacity while the notification or needs-you state is active; the C-shape stays at full opacity <!-- claim:notify:favicon-workspace-badge-notification-dimmed -->

### 13.4 Tab Title Indicator

Visual indicator in browser tab: <!-- claim:notify:tab-indicator -->

- Prepend `* ` to tab title when the session finishes and user hasn't interacted <!-- claim:notify:tab-indicator-prefix -->
- Clear prefix on any user interaction (click, typing) or window focus <!-- claim:notify:tab-indicator-clear -->

### 13.5 Needs You

- The agent can mark its session as needing you, with a one-line reason saying what it needs <!-- claim:notify:needs-you -->
- When the agent writes its message and then marks the session as needing you as the last thing it does, the turn ends there and the message shows once <!-- claim:notify:needs-you-ends-turn -->
- A question or plan approval awaiting your answer marks the session as needing you on its own <!-- claim:notify:needs-you-forms -->
- The session stops needing you when you send a message or answer in it; opening it does not <!-- claim:notify:needs-you-clears -->
- A session keeps needing you across a stop and a resume <!-- claim:notify:needs-you-persists -->
- A fork starts without needing you <!-- claim:notify:needs-you-fork -->
- A session started by another session never needs you; its questions go to the session that started it. A fork of it can <!-- claim:notify:needs-you-spawned -->
- A reply thread never needs you <!-- claim:notify:needs-you-side-thread -->
- The agent can offer up to five replies with its ask; they show as buttons at the bottom of its last message, the first one highlighted <!-- claim:notify:needs-you-replies -->
- In Focused the agent's needs-you call shows no block of its own; the needs-you mark and the reply buttons show as in every view <!-- claim:notify:needs-you-call-focused -->
- The buttons stay below everything the agent adds afterwards, until you send a message <!-- claim:notify:needs-you-replies-last -->
- Clicking a button sends its text at once, together with anything in the message box <!-- claim:notify:needs-you-replies-send -->
- Each button has a small arrow at its right end that puts the button's text in the message box instead of sending it; the message box takes the cursor at the end of the text, and the buttons stay <!-- claim:notify:needs-you-replies-edit -->
- Whatever the message box held stays reachable with Up: text typed there moves onto the draft stack, an item it was showing from history or the draft stack stays where it was, and a box already holding the button's text stays as it is; attachments and buffered replies stay as they were <!-- claim:notify:needs-you-replies-edit-keeps-draft -->
- A reply edited in the message box and then sent shows as an ordinary message <!-- claim:notify:needs-you-replies-edit-sends-plain -->
- A reply sent together with text from the message box shows in its bubble as the reply, a thin rule, then the text <!-- claim:notify:needs-you-replies-bubble -->
- A new ask replaces the buttons, and a question or plan approval removes them <!-- claim:notify:needs-you-replies-replaced -->

---

## 14. MCP Status Panel

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

## 15. Bookmarks

### 15.1 Bookmark Toggle

- Bookmark button shown on user message rows (between rewind and copy buttons); on assistant turns, bookmark button is persistently visible in the turn's meta area alongside the copy button <!-- claim:bookmark:toggle-btn -->
- User-turn bookmark hidden by default, visible on hover; assistant-turn bookmark always visible; filled yellow when active, outline when inactive <!-- claim:bookmark:toggle-visibility -->
- Clicking toggles bookmark state; survives refresh and resume <!-- claim:bookmark:persistence -->
- Hovering a part of an assistant message - paragraph, heading, list, table, quote, formula, HTML block - shows a bookmark button just before its copy button; hovering the header of a tool call the agent made shows one too <!-- claim:bookmark:part-toggle-btn -->
- A part or tool-call bookmark button is outline when inactive and filled yellow when active; an active tool-call button stays visible without hovering <!-- claim:bookmark:part-toggle-visibility -->
- A bookmarked part or tool call shows the yellow corner marker on itself; the turn's own bookmark button is unaffected <!-- claim:bookmark:part-marker -->
- Calls a subagent makes inside its task, and thinking, have no bookmark button <!-- claim:bookmark:part-scope -->

### 15.2 Minimap Indicators

- A turn displays as a fully highlighted yellow sub-bar segment in the minimap when it, or any part or tool call in it, is bookmarked <!-- claim:bookmark:minimap-segment -->

### 15.3 Bookmarks Panel

- Side panel on right strip below Crons and above Boards, accessible via Alt+5 <!-- claim:panel-bookmarks:shortcut -->
- Two tabs: "This session" and "All sessions", with count badges <!-- claim:panel-bookmarks:tabs -->
- Active tab tracks active-session presence: "This session" while a session is open, "All sessions" while none is. Manual clicks override; the next session-state change re-asserts the auto-mapping (auto-switch wins) <!-- claim:panel-bookmarks:tab-auto-switch -->
- "This session" tab lists bookmarks in current session; clicking scrolls to the bookmarked turn <!-- claim:panel-bookmarks:session-scroll -->
- Clicking a part or tool-call bookmark scrolls to that part or call and flashes it, opening its turn and any group folded around it; a call shown outside the conversation lands on its turn <!-- claim:panel-bookmarks:part-scroll -->
- A part bookmark previews the part's opening text; a tool-call bookmark previews the call's header line <!-- claim:panel-bookmarks:part-preview -->
- Opening a part or tool-call bookmark from another session, in a new tab, or by reloading its link lands on that part <!-- claim:panel-bookmarks:part-deep-link -->
- "All sessions" tab lists bookmarks from all sessions, sorted by recency; clicking navigates to the session; visible without an active session <!-- claim:panel-bookmarks:all-sessions -->
- Loading state on cold load: panel-level italic muted "Loading..." placeholder; tabs and list appear only after first load <!-- claim:panel-bookmarks:loading -->
- Empty state on both tabs: centered, italic, muted "No bookmarks" <!-- claim:panel-bookmarks:empty -->
- Each bookmark shows preview text (first 80 chars), relative timestamp, and a colored status dot reflecting the source session's state, in the same colors and states as a Sessions panel row (§5.1) <!-- claim:panel-bookmarks:preview --> <!-- claim:panel-bookmarks:status-dot -->
- A bookmark's relative timestamp keeps up as time passes while the panel stays open <!-- claim:panel-bookmarks:time-live -->
- Hovering a truncated preview reveals the full text in a native tooltip <!-- claim:panel-bookmarks:tooltip -->
- Remove button anchored to the top-right corner of each item, visible on hover <!-- claim:panel-bookmarks:remove -->
- Middle-click or Alt+click opens the bookmarked session in a new browser tab; the originating item flashes briefly to confirm the action <!-- claim:panel-bookmarks:new-tab -->

### 15.4 Cross-Tab Sync

- Adding or removing a bookmark shows at once in another open tab of the same browser <!-- claim:bookmark:cross-tab -->

---

## 16. Tasks Panel

### 16.1 Purpose

Panel for monitoring background tasks: <!-- claim:panel-task:panel -->

- Lists background subagents and background shell commands the agent started <!-- claim:panel-task:lists-commands -->
- A command row carries a terminal icon <!-- claim:panel-task:command-icon -->

- Filter tabs: "Active" (running only) and "All" (including completed/failed/killed); badge counts per filter <!-- claim:panel-task:filter-tabs -->
- Tasks sorted chronologically (oldest first) <!-- claim:panel-task:sort-chronological -->
- Click task focuses chat tab, then scrolls the column holding its block to the top of the visible area with a brief highlight pulse <!-- claim:panel-task:click-tab -->
- With the agent's work shown, a task click lands in the work column instead of the transcript; the transcript does not move <!-- claim:panel-task:click-work-column -->
- With the terminal shown, a command row click lands on the command's entry in the terminal column <!-- claim:panel-task:click-terminal-column -->
- Clicking a task whose place in the conversation has scrolled out of view still brings it into view <!-- claim:panel-task:click-reaches-history -->
- Clicking a task inside a collapsed turn opens that turn and shows the task <!-- claim:panel-task:click-opens-collapsed-turn -->
- Empty state: "No tasks" <!-- claim:panel-task:empty -->
- Resume state: "Resuming..." <!-- claim:panel-task:resume -->

### 16.2 Task Item Display

| Element | Content |
|---------|---------|
| Status indicator | Running/completed/failed colored left border; "killed" displayed as "failed" | <!-- claim:panel-task:status-indicator -->
| Description | Task description from invocation; for a command without one, the command itself | <!-- claim:panel-task:description -->
| Duration | Time since start (live for running); for a finished background task, how long it ran | <!-- claim:panel-task:duration -->

### 16.3 Staleness Indication

Running tasks show staleness via left border color gradient: <!-- claim:panel-task:staleness -->

- Fresh (≤15s since last event): blue <!-- claim:panel-task:staleness-fresh -->
- Transitioning (15–90s): blue → purple → amber gradient <!-- skip:claim:panel-task:staleness-gradient -->
- Stale (>90s): amber fading toward gray <!-- skip:claim:panel-task:staleness-faded -->
- New event resets color to fresh immediately <!-- skip:claim:panel-task:staleness-reset -->
- Only running subagent rows show staleness coloring; command rows and completed tasks use static status colors <!-- claim:panel-task:staleness-running-only -->

---

## 17. Crons Panel

Panel listing the open session's scheduled prompts: <!-- claim:panel-cron:panel -->

- Open by default in the right column, below Tasks, in a workspace with no saved layout <!-- claim:panel-cron:default-open -->
- Two tabs: "This session" and "All sessions", with counts <!-- claim:panel-cron:tabs -->
- Active tab follows session presence: "This session" while a session is open, "All sessions" while none is; a tab picked by hand holds until the next session change <!-- claim:panel-cron:tab-auto-switch -->
- "All sessions" lists the schedules of every running session in the workspace, soonest first, each row naming its session; a session's schedules leave when it stops and return when it resumes <!-- claim:panel-cron:all-sessions -->
- Clicking another session's row opens that session at the call that scheduled the prompt; on either tab, middle-click or Alt+click opens a row's session in a new tab at that call <!-- claim:panel-cron:all-sessions-click -->
- When other sessions' schedules cannot be loaded, "All sessions" says "Could not load other sessions' schedules" <!-- claim:panel-cron:all-sessions-error -->
- Lists active schedules only, soonest first <!-- claim:panel-cron:active-sorted -->
- Each row shows when it next fires (live), the schedule in words, the first line of its prompt, and for a repeating schedule when it expires <!-- claim:panel-cron:row -->
- A row's prompt starts at the row's left edge, under when it fires and its schedule <!-- claim:panel-cron:row-layout -->
- Hovering a row's prompt shows the whole prompt in a native tooltip <!-- claim:panel-cron:tooltip -->
- A schedule leaves the list when deleted, after a one-time schedule fires, or when a repeating schedule expires; a one-time schedule whose time passed while the session was stopped is gone after resume <!-- claim:panel-cron:removal -->
- A repeating schedule shows the time it will actually fire <!-- claim:panel-cron:actual-fire-time -->
- A schedule that comes due while the agent is working stays listed as due until that turn ends, when it fires <!-- claim:panel-cron:due -->
- Clicking a row scrolls the chat to where it was scheduled <!-- claim:panel-cron:click -->
- Read-only: no controls to edit or cancel <!-- claim:panel-cron:read-only -->
- Icon-strip badge counts active schedules <!-- claim:panel-cron:badge -->
- Empty state: "No scheduled prompts" <!-- claim:panel-cron:empty -->

## 18. Usage Panel

### 18.1 Panel Content

Aggregated cost display over time intervals: <!-- claim:panel-usage:content -->

| Interval | Description |
|----------|-------------|
| 24 hours | Cost from sessions started within 24 hours | <!-- claim:panel-usage:24h -->
| 7 days | Cost from sessions started within 7 days | <!-- claim:panel-usage:7d -->
| 30 days | Cost from sessions started within 30 days | <!-- claim:panel-usage:30d -->
| All time | Total cost across all sessions | <!-- claim:panel-usage:all -->

- Cost formatted as `$X.XX` <!-- claim:panel-usage:format -->
- Zero cost shows `$0.00` <!-- claim:panel-usage:zero -->
- Refreshes when sessions change, and as a session ages out of an interval <!-- claim:panel-usage:update -->
- Forked sessions contribute only their post-fork spend to the totals; pre-fork spend is attributed once to the ancestor session it originated in <!-- claim:panel-usage:fork-dedup -->

---

## 19. Logs Panel

### 19.1 Panel Content

Real-time log viewer:

- Entry format: timestamp, log level, logger name, message <!-- claim:panel-log:format -->
- Shows the latest 1,000 log entries; older entries are not shown <!-- claim:panel-log:latest-thousand -->
- Log levels color-coded (debug, info, warning, error, critical) <!-- claim:panel-log:colors -->
- Auto-scroll to latest; respects user scroll position <!-- claim:panel-log:autoscroll -->
- No container: "No active session" <!-- claim:panel-log:no-container -->
- Connecting state: "Connecting..." <!-- claim:panel-log:connecting -->
- Empty state: "No logs yet" <!-- claim:panel-log:empty -->
- Resume state: "Resuming..." <!-- claim:panel-log:resume -->

---

## 20. Skills Panel

### 20.1 Panel Content

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

## 21. Workspaces & Containers

### 21.1 Workspace Discovery

- Available workspaces appear on page load <!-- claim:workspace:discovery -->
- Single workspace: auto-selected; no workspace-list dropdown shown (color palette still appears in chat group; see §21.2) <!-- claim:workspace:auto-select -->
- Multiple workspaces: selection priority is URL hash > saved preference > first workspace <!-- claim:workspace:selection-priority -->

### 21.2 Workspace Switcher

- Dropdown in the chat-area header tab bar (right-aligned) <!-- claim:workspace:switcher -->
- Shows current workspace name with chevron <!-- claim:workspace:switcher-label -->
- Always visible in chat group; shows color palette for single workspace, workspace list + palette for multiple <!-- claim:workspace:switcher-visibility -->
- A workspace color picked while the sessions list refreshes stays as picked <!-- claim:workspace:color-survives-refresh -->
- Dropdown lists all workspaces with path; checkmark on active <!-- claim:workspace:switcher-list -->
- External link icon per workspace: opens workspace in new browser tab <!-- claim:workspace:switcher-new-tab -->
- Middle-click on workspace item opens it in a new browser tab <!-- claim:workspace:switcher-middle-click -->
- Switching workspaces clears session data and stash <!-- claim:workspace:switcher-reset -->
- Each workspace row has a trash icon (revealed on hover) — clicking it opens a confirm modal that deregisters the workspace on confirm <!-- claim:workspace:deregister -->
- Deregistering preserves the `.workspace` marker file on disk; only the workspace's registration with Claudebox is removed <!-- claim:workspace:deregister-preserves-marker -->
- A "+ Register workspace…" footer item below the color palette opens a modal that accepts an absolute path, or one starting with ~, to an existing directory and registers it <!-- claim:workspace:register -->
- Registering a directory makes it a workspace in its own right: its sessions, its agent's login and its interface state live under it, and no other directory's sessions are listed for it <!-- claim:workspace:register-marker -->
- A path that is not absolute, has no directory at it, is a file, or cannot be made a workspace is refused: the modal stays open and says which, and nothing is registered <!-- claim:workspace:register-invalid-path -->
- Registering an already-known path is idempotent: the modal shows an inline notice and auto-closes; no duplicate workspace row is created <!-- claim:workspace:register-idempotent -->

### 21.3 Deep Linking

- URL form: `#/workspaces/{workspaceId}/sessions/{sessionId}` <!-- claim:workspace:url-routing -->
- Supports deep linking and browser back/forward navigation <!-- claim:workspace:url-deep-link -->
- Deep link to session in different workspace triggers automatic workspace switch <!-- claim:workspace:url-cross-workspace -->
- URL updates on session switch, workspace switch, and new session creation <!-- claim:workspace:url-update -->

### 21.4 Container Status Indicators

- Colored dot on the session header strip: same colors and states as session panel rows (§5.1) <!-- claim:container:tab-dot -->
- Colored dot on session panel rows: same colors and states, plus dark orange while a running session needs you and purple while it works (§5.1) <!-- claim:container:panel-dot -->
- Dot color mapping: running (green), stopping (amber), all other states (gray); a session's dot shows purple, a dimmer purple or dark orange over running while its agent works, waits on background work or needs you (§5.1) <!-- claim:container:dot-states -->
- Stopping a session shows the stopping color on every status dot at once; once the container is gone, all dots clear together — no dot stays showing stopping, and none keeps showing running <!-- claim:container:stop-clears-uniformly -->
- A side conversation finishing its answer clears only its own dot; the conversation it came from keeps showing running throughout <!-- claim:container:thread-stop-independent -->

### 21.5 Session Creation Overlay

When creating a new session: <!-- claim:container:creation-overlay -->

| Feature | Behavior |
|---------|----------|
| Header strip indicator | Session name slot shows "Creating…" with a spinner | <!-- claim:container:provisional-tab -->
| Progress bar | Indeterminate (no percentage) | <!-- claim:container:creation-progress -->
| Status text | "Creating session...", "Starting session..." | <!-- claim:container:creation-status -->
| Textarea | Visible and editable; submitted messages queued and auto-sent when session is ready | <!-- claim:container:creation-textarea -->
| Submitted messages | Appear in the chat history as regular pending and queued user messages — same shape and width as during a normal chat | <!-- claim:container:creation-messages-inline -->
| Overlay | Stays until the create request has finished | <!-- claim:container:creation-overlay-spans-request -->
| On success | Header strip swaps "Creating…" for the session name; overlay dismissed | <!-- claim:container:creation-success -->
| On failure | Header strip clears the "Creating…" placeholder; error shown; anything typed while it was being created is back in the message box, and nothing is sent or queued in the session left behind | <!-- claim:container:creation-failure -->
| Messages submitted while creating | Sent and queued only in the session being created; a queued one offers no send-now until it exists | <!-- claim:container:creation-input-own-session -->

- A workspace or mount that lives under /tmp fails creation with a message naming the path and the setting that allows it <!-- claim:container:creation-tmp-conflict -->
- Several sessions of one workspace run side by side when its settings publish a fixed port; the first to start holds that port and each later one publishes it on a free port instead (needs a real container host; proven by the daemon's fake-podman tests) <!-- skip:claim:container:fixed-port-side-by-side -->
- A network mode in the workspace settings or a bundle that leaves a session in the browser unreachable (host, none, or another container's or namespace's network) fails creation with a message naming the mode and where it is set <!-- claim:container:creation-network-mode-refused -->
- Starting or reloading a session leaves the session list in place - its rows stay as they were while the session comes up - so the browser stays responsive however many sessions the workspace holds <!-- claim:container:start-keeps-session-list -->

### 21.6 Session Resume Overlay

When resuming an existing session: <!-- claim:container:resume-overlay -->

| Feature | Behavior |
|---------|----------|
| Progress bar | Determinate (fills as events replay) | <!-- claim:container:resume-progress -->
| Phase 1 | "Starting session...", "Resuming session..." | <!-- claim:container:resume-daemon-phase -->
| Previous session | Never shown in place of the session being opened while it starts | <!-- claim:container:resume-no-previous-session -->
| Phase 2 | Replay progress: "Replaying events (X/Y)..." | <!-- claim:container:resume-replay-phase -->
| Textarea | Stays usable and focused during resume; a message typed while the conversation is still loading - sent with Enter or queued with Alt+Enter - stays in the composer, ready to send once the conversation is on screen, and nothing is sent meanwhile, buffered inline replies included; loading lasts until the session being opened is on screen, however long starting it takes | <!-- claim:container:resume-textarea-stays-enabled -->
| Actions while opening | Picker changes wait for the session being opened or created and reach only that session, even when another session is opened before all of them have taken effect; the other session's footer never shows them; Stop does nothing to the session left | <!-- claim:container:opening-actions-own-session -->

### 21.7 Containers Panel

A bottom-slot panel listing the current workspace's containers. Mounted at the bottom-left slot of the bottom-panel strip.

- Each row shows: a colored state dot, the 8-character session identifier (matching the Sessions panel), the container's 8-character identifier (the same one shown in the footer when the active session is attached to that container), the session name, the capitalized state name (Running / Starting / Stopping / Crashed / Stopped), the capitalized kind label, and the relative age <!-- claim:panel-containers:columns --> <!-- claim:panel-containers:id-source -->
- A running container's dot shows its own session's state the way a Sessions panel row does (§5.1) - purple while working, a dimmer purple while waiting on background work, dark orange while it needs you - and hovering it names that state; starting, stopping, crashed and stopped containers keep their own colors, and the state column always names the container's state <!-- claim:panel-containers:session-state-dot -->
- A container's relative age keeps up as time passes while the panel stays open <!-- claim:panel-containers:age-live -->
- Hovering the container identifier shows a tooltip reading `Container — <full identifier>` (the same string the footer's container pill shows) <!-- claim:panel-containers:id-tooltip-format -->
- Hovering the session identifier shows a tooltip reading `Session directory — <full path>` (the same string the Sessions panel and the footer show on the session identifier) <!-- claim:panel-containers:session-id-tooltip-format -->
- Clicking the container identifier copies the full identifier to the clipboard; a brief "Copied!" indicator appears in the same slot and reverts after a short interval <!-- claim:panel-containers:id-copy-on-click -->
- Clicking the session identifier copies the session directory path to the clipboard; a brief "Copied!" indicator appears in the same slot and reverts after a short interval <!-- claim:panel-containers:session-id-copy-on-click -->
- Columns line up vertically across all rows <!-- claim:panel-containers:row-grid -->
- The state dot sits clear of the session identifier, as far from it as the columns sit from each other <!-- claim:panel-containers:dot-gap -->
- The container and session identifiers appear in a small monospace font <!-- claim:panel-containers:id-typography -->
- When the attached session has no custom name, the session-name cell is empty <!-- claim:panel-containers:session-name-empty -->
- Row text and icons share a common vertical baseline <!-- claim:panel-containers:row-baseline -->
- The resume control's Play and chevron sit level with the Stop button and the row's text <!-- claim:panel-containers:actions-level -->
- Containers for the current workspace appear in the list — switching workspaces refreshes the panel to show that workspace's containers <!-- claim:panel-containers:list -->
- Rows are sorted by state group (running → starting → stopping → crashed → stopped); within each group, newer containers appear first <!-- claim:panel-containers:sort -->
- Rows update without manual refresh as containers start, transition state, or stop <!-- claim:panel-containers:live-updates -->
- A "Stop" button on each running or starting row stops and removes the container (matches the sessions-panel and main-header stop affordance) <!-- claim:panel-containers:stop -->
- Rows with an attached session show a Play+chevron resume control: clicking Play opens the session in the current tab; Alt-click or middle-click opens in a new browser tab; the chevron opens a dropdown with both options explicit. The resume control is not shown on the current container's row (the session you are already viewing). <!-- claim:panel-containers:open-session -->
- The current container's row is highlighted with an accent-colored left border and a darker background, matching how the active session is highlighted in the Sessions panel <!-- claim:panel-containers:current-highlight -->
- The Resume control is not shown on the current container's row <!-- claim:panel-containers:current-no-resume -->
- Empty state: "No containers" <!-- claim:panel-containers:empty -->

### 21.8 Welcome State

- When no session is active, chat panel shows welcome page <!-- claim:container:welcome-state -->
- Workspace name displayed prominently; colored with workspace accent if set, otherwise default text color <!-- claim:container:welcome-name -->
- Workspace path displayed below name (muted) <!-- claim:container:welcome-path -->
- When the workspace has no login for the agent, the welcome page says so and names claudebox run as the step that logs in; a workspace with a login, an access key in its settings, or a non-Claude agent shows no such notice <!-- claim:container:welcome-login-notice -->
- Chat input anchored to the bottom of the chat panel, visually indistinguishable from the active-session input (full panel width, same surrounding controls); submitting Enter creates a new session, under the bundle picked on the welcome screen if any, and sends the typed message as its first message <!-- claim:container:welcome-input -->
- Alt+Enter on the welcome screen leaves the typed text in the box <!-- claim:container:welcome-alt-enter-keeps-text -->
- Picker changes (model, permission mode, effort level) made on the welcome screen apply to the next session created from that welcome view, over any starting value a session bundle sets, and a change made while a session is still opening applies to that session; opening an existing session or switching workspace instead discards them, and the pickers then show that session's or workspace's values; only the latest value per picker is applied; pickers display the chosen values immediately; a first message typed with them is sent after they apply <!-- claim:input:welcome-config-buffer -->
- A message sent while a session opens is answered even when the agent refuses a picker change made at the same time <!-- claim:input:opening-refused-pick-answered -->
- Leaving a session - for the bare workspace address, another workspace or a board - lets go of it: nothing done afterwards (picker changes, a typed message, Stop) reaches the session left, and the footer and Logs panel no longer show it; on the bare workspace address the welcome page shows <!-- claim:container:welcome-after-leaving -->
- Keyboard shortcuts reference card listing key bindings (Alt+N, Alt+Shift+N, Alt+arrows, Alt+C, Alt+1..9, Alt+?) <!-- claim:container:welcome-shortcuts -->

### 21.9 Nested Containers

- A workspace may opt in so the agent can run and build its own containers inside its session <!-- claim:container:nested-opt-in -->
- Containers the agent runs stay invisible to the host and to other sessions, and disappear when the session ends <!-- claim:container:nested-isolation -->

### 21.10 Session Bundles

A workspace may declare named session bundles - alternative starting setups a new session can be created under.

- The "+" dropdown lists, below a divider, one "New session - <name>" row per declared bundle in declaration order; both "+" buttons show the same rows <!-- claim:bundle:menu-rows -->
- Choosing a bundle row starts a session under that bundle <!-- claim:bundle:menu-start -->
- On the welcome screen a bundle picker sits beside the model, effort and permission pickers, showing the chosen bundle immediately; the next session created from the welcome view starts under it <!-- claim:bundle:welcome-picker -->
- A workspace declaring no bundles shows no divider, no bundle rows, no bundle picker and no bundle name in the footer <!-- claim:bundle:none-declared -->
- A session started under a bundle shows the bundle's name in the footer; it reports rather than offers, and clicking it opens nothing <!-- claim:bundle:pill-read-only -->
- Hovering the bundle name lists the starting values the bundle set and names the other settings it carries <!-- claim:bundle:tooltip -->
- A dot appears beside the bundle name once a model, effort level, permission mode or session prompt the bundle set is no longer what the session runs, and clears when the value is set back <!-- claim:bundle:drift -->
- A value picked on the welcome screen over the bundle's shows the dot from the session's first moment <!-- claim:bundle:drift-from-welcome -->
- A bundle that sets none of those values never shows the dot <!-- claim:bundle:no-drift-possible -->
- A side thread opened on its own shows the bundle of the session it came from <!-- claim:bundle:side-thread -->

---

## 22. Mobile

A single-column layout for narrow screens: top bar, status strip, chat area only. No side panels, icon strips, or tab bar.

- The mobile layout shows neither the bundle picker nor a session's bundle name <!-- claim:mobile:no-bundle -->

### 22.1 Activation

- On touch-primary devices (phones and tablets), the app shows the mobile layout instead of the desktop layout <!-- claim:mobile:activation -->
- Layout classification depends on device type, not browser window size <!-- claim:mobile:viewport-change -->

### 22.2 Layout Structure

Top to bottom: top bar, status strip, chat area. The drawer slides in from the left and the details sheet drops down from below the top bar — both appear over the chat area when opened. <!-- claim:mobile:layout-structure -->

### 22.3 Top Bar

| Element | Behavior |
|---------|----------|
| Hamburger (left) | Tapping opens the navigation drawer | <!-- claim:mobile:top-hamburger -->
| Session name (center) | Shows the active session name | <!-- claim:mobile:top-session-name -->
| Session name fallback | Shows "claudebox" when there is no session name | <!-- claim:mobile:top-session-name-default -->
| Stop affordance | The chat send button doubles as the stop control on mobile | <!-- claim:mobile:send-button-stop -->
| Details button (right) | Tapping toggles the details sheet open and closed | <!-- claim:mobile:top-details-toggle -->

### 22.4 Status Strip

A thin, non-interactive bar below the top bar.

- Connection dot is green when connected <!-- claim:mobile:status-connected -->
- Connection dot is gray when disconnected <!-- claim:mobile:status-disconnected -->
- Context usage percentage is displayed next to a fill bar that grows with usage <!-- claim:mobile:status-context-pct -->
- Percentage display caps at 100% even when context is exceeded <!-- claim:mobile:status-context-cap -->
- Fill bar color shifts with usage level (e.g. green → amber → red as usage rises) <!-- claim:mobile:status-context-color -->

### 22.5 Navigation Drawer

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

### 22.6 Details Sheet

Drops down from below the top bar when the details button is tapped.

- Tapping outside the sheet closes it <!-- claim:mobile:details-dismiss -->
- Shows: connection status, workspace name, turn count, total cost (two decimals, USD), elapsed duration, context usage percentage, model, effort level, and permission mode <!-- claim:mobile:details-fields -->
- The sheet's background is visually distinct from the chat behind it <!-- claim:mobile:details-sheet-bg -->

### 22.7 Chat Area

- The welcome screen leads with a touch-suited usage prompt <!-- claim:mobile:welcome-touch -->
- Chat occupies the full content width <!-- claim:mobile:chat-fullwidth -->
- The send button doubles as a stop button while a response is in flight; tapping it interrupts the response <!-- claim:mobile:send-button-morph -->
- Tapping the chat input keeps the page at its current zoom level <!-- claim:mobile:no-zoom -->

### 22.8 Drawer Session Rows

- Each drawer session row shows a status dot, ID prefix, optional name, an edit pencil, started–updated timestamps, turns, cost, and first/last message previews — matching the desktop session item content <!-- claim:mobile:session-list-rich -->
- A drawer row's status dot shows a working session the same way a desktop row does (§5.1) <!-- claim:mobile:session-list-working-dot -->
- Tapping anywhere on a non-current session row resumes that session in the current browser tab and closes the drawer <!-- claim:mobile:session-list-tap-resume -->

---

## 23. CLI

The host-side `claudebox` binary is a verb-mode command line: `claudebox <verb> [options] [-- agent-args]`. Each verb is a discrete subcommand with its own help and options.

### 23.1 Run

Running `claudebox run` launches an agent session in a fresh container:

- The agent's exit code is the command's exit code <!-- claim:cli:run -->
- Arguments after `--` are forwarded to the agent <!-- claim:cli:run:args-passthrough -->
- If no `.workspace` marker is found by walking up from the current directory, the current directory is used as the workspace; no error, no prompt <!-- claim:cli:run:workspace-fallback -->
- `run` operates without registering the workspace; the session works in cwd-as-workspace fallback mode <!-- claim:cli:run:no-auto-register -->
- The first run in a workspace that has never started a session reaches the agent without any manual setup <!-- claim:cli:run:fresh-workspace -->
- When a host port the workspace settings publish is already in use, run and shell publish it on a free port instead and print which <!-- claim:cli:run:port-in-use -->

### 23.2 Build

Running `claudebox build` produces a container image:

- Running `build` produces a usable image; no agent session is started <!-- claim:cli:build -->
- `--layer all` rebuilds the entire image; `--layer agent` rebuilds only the agent layer <!-- claim:cli:build:layer -->
- When the build fails, the command exits with the same code the build tool would have <!-- claim:cli:build:failure-propagated -->

> The `build` verb operates on the container image; `update` operates on Claudebox itself (Claudebox's library on the host). They are unrelated despite both being able to refresh "the agent" — `build` rebuilds the agent layer in the image; `update` refreshes Claudebox's own installed code.

### 23.3 Shell

Running `claudebox shell` opens a fresh container with a bash prompt <!-- claim:cli:shell -->

### 23.4 Prune

Running `claudebox prune` removes accumulated resources:

- Running `prune` removes sessions unused past the session lifetime - 365 days unless the settings say otherwise, judged by how long since a session was last used or resumed, not when it was started - and never removes a session whose container is running, regardless of age, a side conversation inside a running container and a session started with `claudebox run` included; it also removes stale temp directories, dangling claudebox images, and stopped claudebox containers (typically none under auto-removal) <!-- claim:cli:prune -->
- Running `prune` empties the `/tmp` of a session that has gone 14 days without activity or a resume - or as many days as the settings say - and keeps the session itself; a session whose container is running and a pinned session keep their `/tmp` <!-- claim:cli:prune-empties-session-tmp -->
- Running `prune` never removes a pinned session, however long ago it was last used; a session unpinned again is judged by its last use like any other. When a workspace's pinned sessions cannot be read, `prune` removes no session in that workspace that run, still sweeps the others, and exits non-zero <!-- claim:cli:prune-keeps-pinned -->
- When `prune` cannot tell which sessions' containers are running in a workspace, it removes no session and empties no `/tmp` there that run, names the workspace, and exits non-zero <!-- claim:cli:prune-running-unknown -->
- Running `prune` from any directory sweeps the sessions of every registered workspace and of your home directory, plus the workspace it runs in when that one is not registered; a registered workspace whose directory no longer exists is skipped with a note <!-- claim:cli:prune-every-workspace -->
- Running `prune` also removes what an interrupted claudebox image build left behind, and leaves what other projects' interrupted builds left; while a claudebox build is running it skips these and says so <!-- claim:cli:prune-build-leftovers -->
- With the local backend, `prune` removes stale directories and reports that container and image cleanup does not apply <!-- claim:cli:prune-local -->
- If a removal fails, the rest still run; the command exits non-zero <!-- claim:cli:prune:partial-failure -->

### 23.5 Version

Running `claudebox version` prints a multi-line block: the package version, the branch and short commit of the installed library, the install path, and the Python version <!-- claim:cli:version -->

### 23.6 Doctor

Running `claudebox doctor` runs an ordered set of environment checks and prints a result row per check; the command exits non-zero if any check failed <!-- claim:cli:doctor -->

The profile check names the profile from your settings; when that profile cannot be read, the check fails <!-- claim:cli:doctor:profile -->

The /tmp check fails when the workspace or a mount lives under /tmp and sessions would remap it, naming the paths and the setting that allows it <!-- claim:cli:doctor:tmp-mounts -->

With the local backend, `doctor`'s runtime checks pass without looking for a container runtime <!-- claim:cli:doctor-local -->

### 23.7 Update

Running `claudebox update` refreshes Claudebox itself:

- Running `update` refreshes Claudebox; verbose output is forwarded when `-v` is passed <!-- claim:cli:update -->
- Running `update` twice in parallel: the second invocation fails immediately with a clear message <!-- claim:cli:update:concurrent-blocked -->

### 23.8 Daemon

Running `claudebox daemon start`, `stop`, `restart`, or `status` controls the host daemon <!-- claim:cli:daemon -->

- Stopping or restarting the daemon finishes as soon as the daemon has shut down; a daemon that does not shut down is forced to stop after about 5 seconds <!-- claim:cli:daemon-stop-prompt -->

### 23.9 Logs

Running `claudebox logs` tails the daemon log:

- Running `logs` shows the most recent daemon output and continues following it <!-- claim:cli:logs -->
- Errors appear red, warnings yellow, regular lines default <!-- claim:cli:logs-colorization -->
- Running `logs all` interleaves daemon and container output; every line is prefixed with its source <!-- claim:cli:logs-all -->
- `logs` shows each record on one line with a date and time, the log level, the logger name, and any extra fields; the on-disk log file is unchanged <!-- claim:cli:logs:rendering -->
- `logs all` shows what the agent and the container API write, interleaved in time order with each line marked `agent` or `api` <!-- claim:cli:logs:multiplex -->
- `logs all` picks up containers that start while it is already running; a short notice names the container when it starts streaming and when it stops <!-- claim:cli:logs-live-discovery -->
- When a container log stream ends, the message says why — exit, connection error, or server error — instead of a bare "stream ended" notice <!-- claim:cli:logs:eof-cause -->

### 23.10 Status

Running `claudebox status` shows daemon, container, and workspace state:

- Running `status` shows daemon, container, and workspace state in three sections <!-- claim:cli:status -->
- When the daemon is stopped, status still shows container and workspace info; the daemon section reports its stopped state <!-- claim:cli:status-degraded -->

### 23.11 Containers

Running `claudebox containers list`, `stop`, or `kill` manages containers across all workspaces:

- The table lists every container across every workspace <!-- claim:cli:containers-list -->
- Each row names the container's session by its 8-character identifier and its name - the one you gave it, else the automatic one - and, while the container runs, what that session is doing: working, waiting, needs you or idle, each in the color its dot shows in the app; a container that is not running leaves that column empty <!-- claim:cli:containers-list-session -->
- Stop signals the container gracefully; the container exits and disappears from the list; supports a single ID or `all` <!-- claim:cli:containers-stop -->
- Kill signals the container forcefully; the container exits and disappears from the list; supports a single ID or `all` <!-- claim:cli:containers-kill -->
- You can pass any unique prefix of a container ID; ambiguous prefixes show matching IDs <!-- claim:cli:containers-prefix-match -->
- When stopping or killing multiple containers, each is reported individually; failures don't abort the rest; the command exits non-zero if any failed <!-- claim:cli:containers-partial-failure -->

### 23.12 Workspaces

Running `claudebox workspaces list`, `register`, or `deregister` manages the daemon's workspace registry:

- Running `workspaces list` shows every registered workspace <!-- claim:cli:workspaces-list -->
- Running `workspaces register` registers the current directory (or the given path) as a workspace and creates the `.workspace` marker if absent <!-- claim:cli:workspaces-register -->
- Registering an already-registered workspace succeeds and reports it was already registered <!-- claim:cli:workspaces-register-idempotent -->
- Two paths sharing a basename get distinct workspace IDs <!-- claim:cli:workspaces-register-collision -->
- Running `workspaces deregister <id>` removes the workspace from the registry; the `.workspace` marker file is preserved <!-- claim:cli:workspaces-deregister -->

### 23.13 Shell completion

Bash tab-completion is opt-in; once enabled, pressing Tab offers context-appropriate completions:

- With bash completion enabled, pressing Tab completes the command tree: verbs, each noun group's actions, and flags <!-- claim:cli:completion -->
- Completing a container target offers container ids across all workspaces plus `all`, falling back to `all` when the daemon is unreachable <!-- claim:cli:completion:container-ids -->
- Completing a workspace to deregister offers the registered workspace ids without contacting the daemon <!-- claim:cli:completion:workspace-ids -->

### 23.14 Help

Command help is colourised - usage, section headings, verb names, option flags and their defaults - and falls back to plain text when colour is unavailable, staying readable and greppable when piped <!-- claim:cli:help-rendering -->

---

## 24. Multi-Runtime Support

Workspaces choose their agent runtime via the `agent` field in `.claudebox/settings.toml`. The active runtime appears in the footer identity pill (§10). Each runtime declares its capability surface, and the frontend shows or hides controls accordingly.

### 24.1 LangGraph Workspaces

- LangGraph workspaces have file-system, shell, search, web, and notebook tools available; the model invokes them and their results appear as tool-use blocks identically to Claude workspaces. Unlike Claude workspaces, there is no per-action approval step or permission mode - the container is the isolation boundary for the whole tool surface <!-- claim:langgraph:file-tools -->
- LangGraph workspaces can spawn sub-agents for focused tasks; the sub-agent runs to completion and its final report appears as a tool result in the parent's chat <!-- claim:langgraph:subagent -->
- LangGraph workspaces have agentic task-list tools (create / get / list / output / stop / update); task state appears in the tasks panel and as in-chat task blocks identically to Claude workspaces <!-- claim:langgraph:task-management -->
- LangGraph workspaces can ask the user structured questions through the interactive Q&A form; the user's selections return to the model as the next message identically to Claude workspaces <!-- claim:langgraph:ask-user-question -->
- LangGraph workspaces discover workspace skills and invoke them by name; the skill body appears as turn-level instructions identically to Claude workspaces, and the slash-command autocomplete plus skills panel surface them on the welcome screen <!-- claim:langgraph:skill -->
- LangGraph workspaces route a typed `/<skill>` command directly to that skill instead of sending it as plain text; the transcript shows the message exactly as typed, and the skill's effect shows up as an ordinary reply with no tool-use block <!-- claim:langgraph:skill-routing -->
- LangGraph workspaces have a tool-search meta-tool the model invokes for self-discovery; the conversation shows the search only when it fails, with what was searched for and what came back <!-- claim:langgraph:tool-search -->
- LangGraph workspaces connect to MCP servers declared per-workspace; the model can list and read their resources and invoke their tools identically to Claude workspaces, and one misbehaving server does not prevent the others from working <!-- claim:langgraph:mcp -->
- LangGraph workspaces talk to the model provider declared in their `[langgraph] model = "provider:model"` workspace setting; the runtime identity pill displays "LangGraph" and the assistant turn appears identically regardless of which provider answers <!-- claim:langgraph:universal-provider-support -->
- A workspace's agent can hand a piece of work to a second session, ask it questions and wait for its answers, and read its transcript, in both Claude and LangGraph workspaces identically; the second session appears as an ordinary row in the Sessions and Containers panels the moment it starts, and either side can be opened in a tab at any time. Depth is capped; a workspace's MCP status panel is unaffected either way <!-- claim:runtime:sibling-sessions -->
