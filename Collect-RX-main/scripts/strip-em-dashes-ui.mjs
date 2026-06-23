#!/usr/bin/env node
/**
 * Remove em dashes (—) from user-facing UI source files.
 * - Table / empty placeholders: N/A
 * - title/subtitle attributes: colon
 * - Other prose: comma
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const files = []
function walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p)
    else if (/\.(tsx|ts)$/.test(name)) files.push(p)
  }
}

walk(path.join(root, 'src/pages'))
walk(path.join(root, 'src/components'))
files.push(path.join(root, 'src/lib/recoveryDisplay.ts'))

let changed = 0
for (const file of files) {
  let s = fs.readFileSync(file, 'utf8')
  const before = s
  s = s.replace(/'—'/g, "'N/A'")
  s = s.replace(/"—"/g, '"N/A"')
  s = s.replace(/(`(?:[^`\\]|\\.)*?) — ((?:[^`\\]|\\.)*?`)/g, '$1, $2')
  s = s.replace(/(title="[^"]*) — /g, '$1: ')
  s = s.replace(/(subtitle="[^"]*) — /g, '$1: ')
  s = s.replace(/ — /g, ', ')
  if (s !== before) {
    fs.writeFileSync(file, s)
    changed++
  }
}

console.log(`Updated ${changed} files (em dashes removed).`)
