/** Labels for text a turn's agent received that no one wrote, by where it came from. */

import { InjectedSource } from '../../../../../utils/eventProcessing'

const SOURCE_LABELS = {
  [InjectedSource.STOP_HOOK]: 'Stop hook',
  [InjectedSource.CLAUDE_CODE]: 'Claude Code',
  [InjectedSource.SYSTEM_REMINDER]: 'System reminder',
}

/** Name an entry's source as the reader sees it. */
export function injectedSourceLabel(source) {
  return SOURCE_LABELS[source]
}

/** Name every source among the entries once, in arrival order. */
export function injectedSourcesTitle(entries) {
  return [...new Set(entries.map(entry => SOURCE_LABELS[entry.source]))].join(', ')
}
