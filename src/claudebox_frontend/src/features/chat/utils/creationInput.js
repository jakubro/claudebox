/** Input typed while a session is created: which creations hold it, and handing it back. */

/** The creations that queued items are held for. */
export function heldCreations(items) {
  return new Set(items.filter(i => i.owner).map(i => i.owner.creation))
}

/** Append messages handed back by a failed creation to input already returned, a blank line apart. */
export function joinReturned(prev, messages) {
  return {
    rawPrompt: [prev?.rawPrompt, ...messages.map(m => m.content)].filter(Boolean).join('\n\n'),
    currentAttachments: [
      ...(prev?.currentAttachments ?? []),
      ...messages.flatMap(m => m.attachments ?? []),
    ],
  }
}
