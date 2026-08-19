/** Pure helpers for extracting a terminal entry's result content. */

/** Result content is a plain string on both runtimes; empty when the field is absent. */
export function resultContentOf(result) {
  return typeof result?.content === 'string' ? result.content : ''
}
