/** Rehype steps tagging a message's top-level blocks with their ordinal and their markdown source span. */

/** Record each root element child's source span by ordinal, before a later step can drop positions. */
export function rehypeRecordBlockSpans() {
  return (tree, file) => {
    file.data.mdBlockSpans = elementChildren(tree).map(child => {
      const start = child.position?.start?.offset
      const end = child.position?.end?.offset
      return start === undefined || end === undefined ? null : [start, end]
    })
  }
}

/**
 * Set `data-md-block` (ordinal) and, where recorded, `data-md-start`/`data-md-end` on each root
 * element child; the ordinals in `marked` also get the `md-block-bookmarked` class.
 */
export default function rehypeMarkBlocks({ marked = [] } = {}) {
  return (tree, file) => {
    const spans = file.data.mdBlockSpans ?? []
    for (const [ordinal, child] of elementChildren(tree).entries()) {
      const span = spans[ordinal]
      const className = [child.properties?.className ?? []].flat()
      child.properties = {
        ...child.properties,
        dataMdBlock: ordinal,
        ...(span && { dataMdStart: span[0], dataMdEnd: span[1] }),
        ...(marked.includes(ordinal) && { className: [...className, 'md-block-bookmarked'] }),
      }
    }
  }
}

function elementChildren(tree) {
  return tree.children.filter(child => child.type === 'element')
}
