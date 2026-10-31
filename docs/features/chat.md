# Chat

The chat surface is built for conversations that run long enough to get lost in. Everything here exists because a thousand-turn session is normal and scrolling is not a navigation strategy.

## Turns collapse, and one stays open

Each exchange is a turn you can collapse by clicking its header. Collapsed, it keeps the full human message and the first line of the reply, so the transcript still reads as a list of what you asked. Browser find still reaches inside a collapsed turn.

Auto-collapse keeps only the newest turn open and folds the rest as they age. A turn you open by hand stays open as new ones arrive.

A finished turn ends on a green ✓ and how long it worked for, a failed one on a red ✗ beside its red edge; hovering the time shows the clock time it ended, and every message you sent shows when you sent it.

![Six turns of a conversation, the older ones folded to their question and a first line, the newest open in full, with the minimap running down the right edge](images/chat-minimap.png)

## The minimap replaces the scrollbar

Beside the transcript is a proportional overview of the whole conversation: one segment per compaction period, one sub-bar per turn, sized by how much the turn actually rendered and how long it took. White marks show human messages; yellow ones show bookmarks. Click or drag anywhere on it to move.

For jumping rather than scanning, `Alt+Up` and `Alt+Down` step between human messages relative to what is on screen, and `Alt+Home` and `Alt+End` go to the ends.

## Knowing when to look

A session tells finished apart from blocked on you. When the agent needs an answer or an approval it marks the session as needing you, with a one-line reason - a question form or a plan approval does so on its own - and the mark stays until you send a message or answer in that session; opening the session does not clear it. While it needs you, its row in the Sessions panel shows a dark orange dot with the reason in place of its last message, and its tab's icon shows a red C.

The agent can offer up to five one-click replies with its ask. They sit as buttons at the bottom of its last message, the first one highlighted, and clicking one sends its text at once, together with anything already in the message box. The small arrow at a button's right end puts its text in the message box instead, to edit before you send it; whatever the box held stays reachable with `Up`.

![A session that needs you: its row in the Sessions panel shows a dark orange dot and the agent's reason, and the agent's last message ends on two reply buttons, each with an arrow for editing it first](images/chat-needs-you.png)

An agent that leaves a background command or subagent running can end its turn and pick up again by itself when that work finishes. In between, the turn says what the session is waiting on, the ring beside it turns at half speed, and the tab's icon dims. A message you send meanwhile starts a turn as usual.

The done signals wait until the session is idle - no turn running and no background work left. Then the tab's icon switches to its notification variant until you come back to the tab, its title gains a leading `* ` until you interact, and, with the bell in the footer on, a hidden tab shows a desktop notification and plays a chime.

## Queue instead of waiting

`Alt+Enter` queues a message rather than sending it. Queued messages sit as dimmed bubbles under the response in progress and drain in order as each reply completes. Hovering one offers send-now, edit and cancel. An interrupt or an error pauses the queue rather than discarding it, and the whole queue is per session and survives a reload.

![Two queued messages sitting as dimmed bubbles under the last exchange, waiting their turn](images/chat-queue.png)

## Attachments

Drag and drop onto the input, or paste an image straight into it. Attachments preview above the composer with a remove control, any file type is accepted up to 10MB each, and images in the transcript open to a zoom overlay on click.

## Copy or bookmark one part

Hovering any paragraph, heading, list, table, quote, formula or HTML block of a reply shows a bookmark and a copy button at its top-right. Copy takes that part's markdown exactly as written - a quote or a callout without its `>` markers. A bookmark points at that part alone: it carries a yellow corner marker, its row in the Bookmarks panel previews it, and opening the bookmark lands on it. A tool call's header offers the same bookmark. A finished turn's closing row copies the agent's final answer by itself, the turn header's copy takes the whole turn, and every code block carries its own.

## What the agent received

Text the agent received that nobody in the conversation wrote - what a Stop hook told it, a note Claude Code adds, a system reminder - stays out of the transcript. The block it follows shows a small triangle in its bottom-right corner; clicking it opens a box listing each piece with its source, as the agent received it. Copying and quoting leave it out.

## Focused or everything

A session opens Focused: its turns leave out the calls that only read - file reads and searches, web searches and fetches, skill loads, shell commands that change nothing, MCP resource reads, and MCP tools their server declares read-only - so what stays is what the agent changed and what it said. A call that failed, or one you bookmarked, shows whatever its kind. The eye button in the control bar shows everything instead, and the terminal and work buttons each show everything too, moving shell commands or every tool call into a right column. With no button pressed the chat is Focused again. A phone always shows Focused.

While the agent is busy with calls Focused leaves out, the line under the turn names the newest of them - `Reading notes.md...`, `Searching the web for backoff jitter...`, `Loading changelog skill...`, or a hidden command's own description - in place of a bare `Working...`.

An MCP tool whose server declares nothing about it stays in Focused, and can be hidden by hand: hovering its block's header shows a `Hide in Focused` button. The mark covers that one tool, for every session of the workspace in every browser, and pressing the button again brings the tool back.

## The right column: terminal or work

The chat area splits in two on desktop, transcript on the left and one of two views on the right. They are mutually exclusive - one slot, one occupant - and the choice, along with the divider position, is remembered per session.

**Terminal** collects every shell command the session has run, oldest first, regardless of which turn ran it. Each entry shows the model's own description as a comment, then the command - one command per line, loop and `if` bodies indented, as in its block - then its output. Long lines scroll sideways rather than wrapping. Failed commands are marked, and visible as failures from the overview without scrolling to them. Turning the column off returns the chat to Focused, which puts every command that changes something back inline in its turn.

![The terminal column listing every shell command the session ran, each under the model's own description, with a failed one marked in red](images/chat-terminal.png)

**Work** collects every top-level tool call instead, grouped by the turn that made it, each rendered as the same block it would have been inline. The transcript keeps the prose and the thinking; the tool calls move out of it. A subagent's own calls stay nested inside its task block.

Either column follows new output while you are at the bottom and holds position when you have scrolled away. `Alt+PageUp` and `Alt+PageDown` step through it - never through the transcript - landing each entry at the top of the column. Every entry offers a jump control that scrolls the transcript to the turn responsible.

Both columns build only what is near the viewport, which is why browser find and Save-as-PDF reach only what is currently on screen.

## On a phone

Touch devices get a different layout, chosen by device type rather than window width: a top bar, a thin status strip, and the chat. No side panels, no icon strips, no tab bar, and no session rail.

Everything the panels would have carried moves into two surfaces. The hamburger opens a drawer with the workspace switcher, a new-session button and the full session list, each row carrying the same detail its desktop counterpart does. The details button drops a sheet with connection, workspace, turn count, cost, elapsed time, context usage, model, effort and permission mode.

The status strip keeps the two things worth watching without opening anything: a connection dot and a context-usage bar that fills and changes color as the window fills. The send button doubles as the stop control while a reply is arriving.

Quoting and inline replies stay on desktop.

## Details

- [Chat panel](../SPEC.md#3-chat-panel) - the full behavior contract
- [Mobile](../SPEC.md#22-mobile)
- [Views](../SPEC.md#318-views-focused--everything--terminal--work)
- [Needs you](../SPEC.md#135-needs-you) and [notifications](../SPEC.md#13-notifications)
- [Copy buttons](../SPEC.md#313-copy-buttons), [bookmarks](../SPEC.md#15-bookmarks) and [added text](../SPEC.md#320-added-text)
- [Threads](threads.md) - quoting, inline replies and the session rail
- [Rendering](rendering.md) - what the chat can draw
- [Keyboard shortcuts](../reference/shortcuts.md)
