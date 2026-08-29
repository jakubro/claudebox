/** Deferred promise, for a caller that must settle independently of the work it joined. */

/** A promise plus the functions to settle it from outside its own executor. */
export function createDeferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
