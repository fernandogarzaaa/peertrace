'use strict'
const Corestore = require('corestore')

const NAMESPACE = 'peertrace'

/**
 * Append-only, signed log of one agent run, backed by a Hypercore.
 * Only the holder of the writer key can append; every reader verifies
 * each entry against the run's public key.
 */
class TraceWriter {
  constructor (storage, { name = 'run' } = {}) {
    this.store = storage instanceof Corestore ? storage : new Corestore(storage)
    this.core = this.store.namespace(NAMESPACE).get({ name, valueEncoding: 'json' })
  }

  async ready () {
    await this.core.ready()
    return this
  }

  get key () { return this.core.key }
  get length () { return this.core.length }

  /** Append one event. seq is derived from the log, so a restarted writer continues where it stopped. */
  async append (type, data = {}) {
    if (typeof type !== 'string' || !type) throw new Error('event type must be a non-empty string')
    const event = { seq: this.core.length, ts: Date.now(), type, data }
    await this.core.append(event)
    return event
  }

  replicate (isInitiator, opts) { return this.store.replicate(isInitiator, opts) }

  async close () { await this.store.close() }
}

/** Read-only view of someone else's run, identified by its public key. */
class TraceReader {
  constructor (storage, key) {
    if (!key) throw new TypeError('a run key is required')
    this.store = storage instanceof Corestore ? storage : new Corestore(storage)
    this.core = this.store.get({ key: typeof key === 'string' ? Buffer.from(key, 'hex') : key, valueEncoding: 'json' })
  }

  async ready () {
    await this.core.ready()
    return this
  }

  get key () { return this.core.key }
  get length () { return this.core.length }

  /** Wait until at least `length` events are available locally (or timeout). */
  async waitFor (length, { timeout = 10000 } = {}) {
    const start = Date.now()
    while (this.core.length < length) {
      if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${length} events (have ${this.core.length})`)
      await new Promise(resolve => this.core.once('append', resolve))
    }
  }

  async events ({ start = 0, end = this.core.length } = {}) {
    const out = []
    for (let i = start; i < end; i++) out.push(await this.core.get(i))
    return out
  }

  /** Live, in-order stream of events; survives disconnects and resumes when peers return. */
  tail ({ start = 0 } = {}) {
    return this.core.createReadStream({ start, live: true })
  }

  async summary () {
    return summarize(await this.events())
  }

  replicate (isInitiator, opts) { return this.store.replicate(isInitiator, opts) }

  async close () { await this.store.close() }
}

function summarize (events) {
  const byType = {}
  let errors = 0
  let toolCalls = 0
  let status = 'running'
  for (const e of events) {
    byType[e.type] = (byType[e.type] || 0) + 1
    if (e.type === 'tool_call') toolCalls++
    if (e.type === 'error') errors++
    if (e.type === 'run_end') status = e.data && e.data.status ? e.data.status : 'done'
  }
  const first = events[0]
  const last = events[events.length - 1]
  return {
    events: events.length,
    toolCalls,
    errors,
    status,
    durationMs: first && last ? last.ts - first.ts : 0,
    byType
  }
}

module.exports = { TraceWriter, TraceReader, summarize, NAMESPACE }
