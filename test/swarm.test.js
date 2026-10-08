'use strict'
const test = require('brittle')
const path = require('path')
const createTestnet = require('hyperdht/testnet')
const Hyperswarm = require('hyperswarm')
const { TraceWriter, TraceReader } = require('../lib')
const { joinSwarm } = require('../lib/swarm')
const { tmpdir } = require('./helpers')

test('end to end over Hyperswarm on a local DHT testnet', async t => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const { bootstrap } = testnet

  const w = await new TraceWriter(path.join(tmpdir(t), 'w')).ready()
  const r = await new TraceReader(path.join(tmpdir(t), 'r'), w.key).ready()
  const s1 = await joinSwarm(w, { client: false, swarm: new Hyperswarm({ bootstrap }) })
  const s2 = await joinSwarm(r, { server: false, swarm: new Hyperswarm({ bootstrap }) })
  t.teardown(async () => {
    await s1.destroy(); await s2.destroy()
    await w.close(); await r.close()
  })

  await w.append('run_start', { model: 'qwen2.5-0.5b' })
  await w.append('tool_call', { tool: 'search' })
  await w.append('run_end', { status: 'ok' })

  await s2.flush()
  await r.core.update({ wait: true })
  await r.waitFor(3, { timeout: 15000 })
  const s = await r.summary()
  t.is(s.events, 3)
  t.is(s.status, 'ok')
})
