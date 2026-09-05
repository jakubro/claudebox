#!/usr/bin/env node
// Prebuild asset copy: public/ is served verbatim, while a markdown reference would reach the image
// pipeline, which has no GIF support and emits the same bytes under a .webp name.

import { copyFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = fileURLToPath(new URL('../../docs/demo.gif', import.meta.url))
const TARGET = fileURLToPath(new URL('../public/demo.gif', import.meta.url))

mkdirSync(path.dirname(TARGET), { recursive: true })
copyFileSync(SOURCE, TARGET)

console.log(`copied ${path.basename(SOURCE)} into public/`)
