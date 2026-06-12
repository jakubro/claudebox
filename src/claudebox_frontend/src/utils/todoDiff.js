/** Pure helpers for the todoDiff shape produced by appendTodoDiffs / appendTaskDiffs. */

/** Terminal task statuses - a blocker in one of these no longer blocks. */
const TERMINAL_STATUSES = new Set(['completed', 'removed'])

/** Bucket order for grouped rendering rows (header bucket order is caller-defined). */
const ROW_BUCKETS = ['completed', 'in_progress', 'pending', 'removed']

/** Whether a todoDiff has at least one item in any of its buckets. */
export function hasDiffItems(diff) {
  if (!diff) {
    return false
  }
  return (
    (diff.added?.length || 0) +
      (diff.started?.length || 0) +
      (diff.completed?.length || 0) +
      (diff.removed?.length || 0) >
    0
  )
}

/**
 * Resolve whether an item is currently blocked, against a frozen set of items
 * (the in-chat grouped Todos block's merged-run set). Returns true iff:
 *   1. item.blockedBy is non-empty, AND
 *   2. at least one blocker (matched by _taskId) is present in `runItems`
 *      with a non-terminal status.
 *
 * Cross-run blockers (taskIds not present in `runItems`) are treated as
 * resolved - keeps the in-chat group self-contained as a frozen snapshot.
 *
 * @param {object} item - Task item with optional blockedBy + _taskId fields.
 * @param {Array<object>} runItems - The set of items the renderer dedup'd by _taskId for this run.
 */
export function deriveBlockedFlag_run(item, runItems) {
  if (!Array.isArray(item?.blockedBy) || item.blockedBy.length === 0) {
    return false
  }
  if (!Array.isArray(runItems) || runItems.length === 0) {
    return false
  }
  const byTaskId = new Map()
  for (const candidate of runItems) {
    if (candidate?._taskId != null) {
      byTaskId.set(String(candidate._taskId), candidate)
    }
  }
  for (const blocker of item.blockedBy) {
    const target = byTaskId.get(String(blocker))
    if (target && !TERMINAL_STATUSES.has(target.status)) {
      return true
    }
  }
  return false
}

/**
 * Resolve whether an item is currently blocked, against a live partition set
 * (the panel's cumulative todosBySubagent for the same subagentKey). Same
 * semantics as deriveBlockedFlag_run but operates on the live snapshot rather
 * than a frozen run.
 *
 * @param {object} item - Task item with optional blockedBy + _taskId fields.
 * @param {Array<object>} partitionItems - Cumulative items for the subagent partition.
 */
export function deriveBlockedFlag_live(item, partitionItems) {
  return deriveBlockedFlag_run(item, partitionItems)
}

/**
 * Walk a run's task blocks in order, collect items from each block's diff
 * buckets, and produce a deduped list - latest item per `_taskId` wins.
 * Items without `_taskId` (TaskCreate diffs emitted before tool_result, or
 * replay races) fall back to content-equality merging.
 *
 * @param {Array<{toolUseId: string}>} taskBlocks - The run's task-list tool blocks, in order.
 * @param {Map<string, object>} todoDiffs - todoDiffs map (toolUseId -> diff).
 * @returns {Array<object>} Deduped items in first-seen order.
 */
export function mergeRunItems(taskBlocks, todoDiffs) {
  if (!(todoDiffs && taskBlocks?.length)) {
    return []
  }
  // Tracks insertion order so the merged output preserves first-seen order
  // for items that update later in the run.
  const order = []
  const byKey = new Map()

  for (const block of taskBlocks) {
    const diff = todoDiffs.get(block.toolUseId)
    if (!diff) {
      continue
    }
    // Apply the bucket-implied status before merging - completed/started come
    // through the diff classifier (see appendTaskDiffs in eventProcessing.js).
    const buckets = [
      { items: diff.completed, status: 'completed' },
      { items: diff.started, status: 'in_progress' },
      { items: diff.added, status: 'pending' },
      { items: diff.removed, status: 'removed' },
    ]
    for (const { items, status } of buckets) {
      for (const item of items || []) {
        // If the diff's bucket-derived status differs from the item's own
        // status field (e.g. a TaskUpdate to in_progress lands the item in
        // .started while the item's own .status reads 'in_progress'), prefer
        // the item's status; the diff buckets are for classification only.
        const effective = item.status || status
        const key = item._taskId != null ? `id:${item._taskId}` : `c:${item.content || ''}`
        if (!byKey.has(key)) {
          order.push(key)
        }
        byKey.set(key, { ...item, status: effective })
      }
    }
  }

  return order.map(k => byKey.get(k))
}

/**
 * Compute per-bucket counts (header) and row order (rendering) for a merged
 * item set. Blocked items count toward the dedicated `blocked` bucket in the
 * header but stay in their actual-status bucket in `rowGroups` so the
 * strikethrough/dim treatment still applies.
 *
 * @param {Array<object>} items - The merged item set (output of mergeRunItems).
 * @returns {{ counts: object, rowGroups: Array<object> }}
 */
export function bucketize(items) {
  const counts = { completed: 0, in_progress: 0, blocked: 0, pending: 0, removed: 0 }
  const rows = { completed: [], in_progress: [], pending: [], removed: [] }
  for (const item of items) {
    const isBlocked = deriveBlockedFlag_run(item, items)
    if (isBlocked) {
      counts.blocked += 1
    } else {
      counts[item.status] = (counts[item.status] || 0) + 1
    }
    const rowBucket = item.status in rows ? item.status : 'pending'
    rows[rowBucket].push(item)
  }
  const rowGroups = ROW_BUCKETS.flatMap(b => rows[b])
  return { counts, rowGroups }
}
