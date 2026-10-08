'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

function tmpdir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'peertrace-'))
  t.teardown(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Connect two traces with an in-memory duplex pair. Returns a function that severs the link (a network partition). */
function link (a, b) {
  const s1 = a.replicate(true)
  const s2 = b.replicate(false)
  s1.pipe(s2).pipe(s1)
  s1.on('error', () => {})
  s2.on('error', () => {})
  return function partition () {
    s1.destroy()
    s2.destroy()
  }
}

module.exports = { tmpdir, link }
