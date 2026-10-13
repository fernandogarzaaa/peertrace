'use strict'

const VALUE_FLAGS = new Set(['--name', '--dir', '--wait', '--timeout', '--bootstrap'])

/**
 * Parse `peertrace <cmd> [positional] [--flag value ...]`.
 * Flags may appear before or after the positional run key.
 */
function parseArgs (argv) {
  const [cmd, ...rest] = argv
  const flags = {}
  const positional = []
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (VALUE_FLAGS.has(a)) {
      const v = rest[i + 1]
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`)
      flags[a.slice(2)] = v
      i++
    } else if (a.startsWith('--')) {
      throw new Error(`unknown option ${a}`)
    } else {
      positional.push(a)
    }
  }
  return { cmd, flags, positional }
}

/** "host:port,host:port" -> [{ host, port }] for a private or test DHT. */
function parseBootstrap (s) {
  if (!s) return undefined
  return s.split(',').map(entry => {
    const i = entry.lastIndexOf(':')
    const port = Number(entry.slice(i + 1))
    if (i <= 0 || !Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`bad --bootstrap entry: ${entry}`)
    return { host: entry.slice(0, i), port }
  })
}

/** Non-negative milliseconds, or the fallback when the flag is absent. */
function parseMs (s, name, fallback) {
  if (s === undefined) return fallback
  const n = Number(s)
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative number of milliseconds`)
  return n
}

/** Validate a decoded stdin line into [type, data]; returns null when it is not a usable event. */
function toEvent (obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  if (typeof obj.type !== 'string' || !obj.type) return null
  return [obj.type, obj.data === undefined ? {} : obj.data]
}

/** Resolve true once the core has at least one replicating peer, false after `timeout` ms. */
function waitForPeer (core, timeout) {
  if (core.peers.length > 0) return Promise.resolve(true)
  return new Promise(resolve => {
    const onPeer = () => { clearTimeout(timer); resolve(true) }
    const timer = setTimeout(() => { core.off('peer-add', onPeer); resolve(false) }, timeout)
    core.once('peer-add', onPeer)
  })
}

module.exports = { parseArgs, parseBootstrap, parseMs, toEvent, waitForPeer }
