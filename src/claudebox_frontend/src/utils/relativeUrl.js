/** Resolve a link or image URL a message writes as a relative path, confined to a base directory. */

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
const TMP = '/tmp'

/**
 * Join a relative `url` to `baseDir` and keep it only while it stays inside: anything with a
 * scheme, `//`, a leading `/` or `#`, or an empty path is not relative and gives null.
 * @param {string} url - The href or src as written; its query and fragment are dropped
 * @param {string} baseDir - Absolute directory the path is relative to
 * @returns {{ absolute: string, relative: string } | null} `relative` is the path below `baseDir`
 */
export function resolveRelative(url, baseDir) {
  if (!(url && baseDir) || SCHEME.test(url) || url.startsWith('/') || url.startsWith('#')) {
    return null
  }
  const decoded = decodePath(url)
  if (!decoded) {
    return null
  }
  const base = normalize(baseDir)
  const absolute = normalize(`${base}/${decoded}`)
  if (!absolute?.startsWith(`${base}/`)) {
    return null
  }
  return { absolute, relative: absolute.slice(base.length + 1) }
}

/** The normalized `/tmp/...` path an image source names, or null when it is not one or leaves /tmp. */
export function resolveTempImage(url) {
  if (!url?.startsWith(`${TMP}/`)) {
    return null
  }
  const decoded = decodePath(url)
  const path = decoded && normalize(decoded)
  return path?.startsWith(`${TMP}/`) ? path : null
}

/** Whether `url` is a relative path: no scheme, and not starting with `/` or `#`. */
export function isRelativeUrl(url) {
  return !!url && !SCHEME.test(url) && !url.startsWith('/') && !url.startsWith('#')
}

/**
 * The image endpoint query for `src`: `/tmp/` reads the session's temp dir, a relative path the
 * workspace; a null `baseDir` turns both off. Undefined loads `src` as written; null must not load.
 * @param {string} [src]
 * @param {{ baseDir: string|null, workspaceDir: string|null, sessionId: string|null }} scope
 * @returns {string|null|undefined}
 */
export function imageEndpointQuery(src, { baseDir, workspaceDir, sessionId }) {
  const temp = resolveTempImage(src)
  if (temp) {
    return sessionId && baseDir !== null
      ? `path=${encodeURIComponent(temp)}&session=${encodeURIComponent(sessionId)}`
      : undefined
  }
  if (!(baseDir && workspaceDir && isRelativeUrl(src))) {
    return undefined
  }
  const resolved = resolveRelative(src, baseDir)
  const relative = resolved && pathBelow(resolved.absolute, workspaceDir)
  return relative ? `path=${encodeURIComponent(relative)}` : null
}

/** `url` when it is an absolute http(s) address, else null. */
export function webPageUrl(url) {
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null
  } catch {
    return null
  }
}

/**
 * `url` as written on the page at `pageUrl`, or null when it does not resolve to http(s).
 * @param {string} url - href or src; absolute, root-relative or relative
 * @param {string} pageUrl - Already checked by webPageUrl
 * @returns {string|null}
 */
export function resolveWebUrl(url, pageUrl) {
  try {
    const resolved = new URL(url, pageUrl)
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null
  } catch {
    return null
  }
}

/**
 * Folder of `filePath`: absolute paths normalized, relative ones joined to `workspaceDir` first.
 * @returns {string|null} null for a relative path with no `workspaceDir`, or one climbing above `/`
 */
export function fileFolder(filePath, workspaceDir) {
  const absolute = filePath.startsWith('/')
    ? filePath
    : workspaceDir && `${workspaceDir}/${filePath}`
  const path = absolute && normalize(absolute)
  return path ? path.slice(0, path.lastIndexOf('/')) || '/' : null
}

/** `path` below `dir` when it lies inside it, else null. */
export function pathBelow(path, dir) {
  const base = normalize(dir)
  return path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null
}

function decodePath(url) {
  const path = url.replace(/[?#].*$/, '')
  try {
    return path ? decodeURIComponent(path) : null
  } catch {
    return null
  }
}

/** POSIX-normalize an absolute path; null when `..` climbs above the root. */
function normalize(path) {
  const parts = []
  for (const segment of path.split('/')) {
    if (segment === '..') {
      if (parts.length === 0) {
        return null
      }
      parts.pop()
    } else if (segment && segment !== '.') {
      parts.push(segment)
    }
  }
  return `/${parts.join('/')}`
}
