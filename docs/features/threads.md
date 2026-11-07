# Threads

A reply can answer a specific sentence where it sits, move somewhere of its own, and leave the original conversation running the whole time, all in one browser tab.

Quoting and replying are desktop gestures. On a phone the chat is a single column.

## Quoting and replying

Any span inside a turn - prose, a code block, tool output, a thinking block - is quoted by drag-selecting it and clicking the quote button, or pressing `Tab` while it shows. The span keeps a durable highlight and a reply box opens beside it, already carrying the quote and who said it, with the cursor in it.

Any number can be open. Each box stays beside its own highlight as the transcript scrolls, and none of them overlaps another. A box resizes from its bottom-right corner and keeps that size, across a reload too. Unsent replies survive a reload.

Hovering a highlight shows its box for a moment, clicking it opens the box, and `Tab` with the mouse resting on it opens the box with the cursor at the end of its reply. `Tab` at the end of a box's text closes it and puts the cursor back in the message box.

![A sentence inside a reply carrying a durable highlight, with a reply box open beside it quoting that sentence back](images/threads-quote-reply.png)

A reply is then either sent with the conversation or asked on its own.

**Send them together.** `Enter` - in the message box, or in any reply box that has not asked on its own - delivers one turn carrying every buffered reply, plus the composer's text. The turn shows a compact placeholder that expands to reveal each quote and its reply. Empty replies are dropped.

**Ask one on its own.** `Ctrl+Enter` in a reply box asks that reply where it sits, and the conversation it was quoted from does not change - same turns, same count, nothing added. It does not wait for that conversation either, whether it is idle or already answering something else. The agent receives the quoted span and then the reply. The answer arrives in the box beside the quote, drawn the way the conversation draws a turn - formatted text, tool calls, thinking, to-do lists - and the box follows it as it arrives until scrolled up inside it. Follow-ups can be asked there too.

![A quoted phrase highlighted in an earlier reply, its box open beside it holding the test command the agent ran and its formatted answer, with the two promote controls in the box's corner](images/threads-ask-alone.png)

## Where a thread can go

A reply asked on its own can live in any of these.

| Destination | Container | Where it lives |
|---|---|---|
| Stays where it is | Shared with the source | Beside its quote |
| Promoted onto the rail | Shared with the source | Its own group, beside the conversation it came from |
| Promoted to its own session | New container, new browser tab | A conversation of its own |

Promoted onto the rail, the thread becomes an ordinary session group, opening at its own exchange, with everything it inherited folded behind a single line that unfolds on click.

## The session rail

The session rail holds a chain of sessions in one tab. A session that spawned children shows them alongside it, root at the left, each group started from inside the one to its left.

Exactly one group is focused. That one has the message box, the control bar and the split into transcript plus right column. The others sit beside it as single columns, reading. Focus moves with `Alt+Shift+Left` and `Alt+Shift+Right`, or by clicking a name in the session header path.

Each group keeps its own draft, its own history and its own message queue. Sending reaches the focused group alone. Scrolling one moves only that one. The whole rail comes back after a reload, same groups, same order, same one focused.

Past a certain depth the rail stops widening: it keeps the root and the groups nearest the focused one, and the ones in between stay reachable from the session header path.

Unrelated sessions still mean separate browser tabs. A chain does not.

![Two session groups side by side: the parent reading as a single column on the left, the focused one on the right with its own message box](images/threads-rail.png)

## Fork and rewind

Every human message carries a rewind button, and the control bar forks the whole conversation without truncating it. Three variants:

| Variant | Container | Where it opens |
|---|---|---|
| Fork here | Reuses the current one | Replaces the current view |
| Fork in new browser tab | New | A new browser tab |
| Fork as a side conversation | Shared with the source | Stays in place |

A fork takes the place its source held, and the source keeps its own history intact and viewable. Forks inherit the parent's name, model, permission mode, effort level, session prompt and settings bundle, and then diverge from there.

![The control bar's fork menu open over the conversation, offering to fork here or in a new browser tab](images/threads-fork-menu.png)

## Related pages

- [Inline replies](../SPEC.md#317-inline-replies) - the full behavior contract
- [Session rail](../SPEC.md#319-session-rail)
- [Conversation rewind](../SPEC.md#312-conversation-rewind)
- [Keyboard shortcuts](../reference/shortcuts.md)
