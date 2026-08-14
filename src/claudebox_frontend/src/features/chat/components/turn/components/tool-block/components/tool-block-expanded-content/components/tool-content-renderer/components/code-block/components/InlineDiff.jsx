/** Render inline diff highlighting for a paired remove/add line. */

import { diffWords } from 'diff'

export default function InlineDiff({ oldLine, newLine, type }) {
  const changes = diffWords(oldLine, newLine)
  return (
    <>
      {changes.map((part, idx) => {
        if (type === 'remove') {
          if (part.removed) {
            return (
              <span key={idx} className="diff-inline-removed">
                {part.value}
              </span>
            )
          }
          if (part.added) {
            return null
          }
          return part.value
        }
        if (part.added) {
          return (
            <span key={idx} className="diff-inline-added">
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return null
        }
        return part.value
      })}
    </>
  )
}
