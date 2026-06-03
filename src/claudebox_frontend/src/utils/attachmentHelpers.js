/** File reading and validation helpers for attachment handling. */

import { MAX_FILE_SIZE } from '../config/thresholds'

/** Read a File as base64 data string (without the data: prefix). */
export function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // result is "data:<mime>;base64,<data>" — extract just the base64 part
      const base64 = reader.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** Validate file size. Returns error string or null. */
export function validateFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    return `${file.name} exceeds 10MB limit (${(file.size / 1024 / 1024).toFixed(1)}MB)`
  }
  return null
}
