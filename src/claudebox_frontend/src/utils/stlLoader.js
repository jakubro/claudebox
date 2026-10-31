/** Lazy three.js loader and ASCII STL parsing for model blocks. */

const SOLID = /\bsolid\b[\s\S]*\bendsolid\b/

let threePromise = null

/** Load three, its STL loader and orbit controls once, on the first model block. */
export function loadThree() {
  threePromise ??= Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/STLLoader.js'),
    import('three/examples/jsm/controls/OrbitControls.js'),
  ]).then(([THREE, { STLLoader }, { OrbitControls }]) => ({ THREE, STLLoader, OrbitControls }))
  return threePromise
}

/**
 * Parse an ASCII STL block to a geometry, or reject with a short reason: no `solid ... endsolid`
 * section, or no facets - which includes STLLoader's RangeError on a text too short to sniff.
 * @param {string} source
 */
export async function parseStl(source) {
  if (!SOLID.test(source)) {
    throw new Error('not an ASCII STL model')
  }
  const { STLLoader } = await loadThree()
  let geometry
  try {
    geometry = new STLLoader().parse(source)
  } catch {
    throw new Error('the model has no facets')
  }
  if (!geometry.getAttribute('position')?.count) {
    throw new Error('the model has no facets')
  }
  return geometry
}
