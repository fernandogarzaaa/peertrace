'use strict'
const test = require('brittle')
const path = require('path')
const { TraceWriter, TraceReader, summarize } = require('../lib')
const { tmpdir, link } = require('./helpers')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('appends events in order with sequential seq numbers', async t => {
  const w = await new TraceWriter(tmpdir(t)).ready()
  t.teardown(() => w.close())
  await w.append('run_start', { model: 'llama-3.2-1b' })
  await w.append('tool_call', { tool: 'search' })
  const e = await w.append('run_end', { status: 'ok' })
  t.is(e.seq, 2)
  t.is(w.length, 3)
  t.alike((await w.core.get(1)).data, { tool: 'search' })
})

test('rejects events without a type', async t => {
  const w = await new TraceWriter(tmpdir(t)).ready()
  t.teardown(() => w.close())
  await t.exception(w.append(''), /non-empty string/)
})

test('reader replicates the full run from the writer', async t => {
  const w = await new TraceWriter(path.join(tmpdir(t), 'w')).ready()
  const r = await new TraceReader(path.join(tmpdir(t), 'r'), w.key.toString('hex')).ready()
  t.teardown(async () => { await w.close(); await r.close() })
  for (let i = 0; i < 10; i++) await w.append('step', { i })
  const cut = link(w, r)
  await r.core.update({ wait: true })
  await r.waitFor(10)
  const events = await r.events()
  t.is(events.length, 10)
  t.alike(events.map(e => e.data.i), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  cut()
})

test('reader cannot append to someone else\'s run', async t => {
  const w = await new TraceWriter(path.join(tmpdir(t), 'w')).ready()
  const r = await new TraceReader(path.join(tmpdir(t), 'r'), w.key).ready()
  t.teardown(async () => { await w.close(); await r.close() })
  t.is(r.core.writable, false)
  await t.exception(r.core.append({ seq: 0, type: 'forged' }))
})

test('network partition: reader catches up after reconnect, live tail has no gaps or duplicates', async t => {
  const w = await new TraceWriter(path.join(tmpdir(t), 'w')).ready()
  const r = await new TraceReader(path.join(tmpdir(t), 'r'), w.key).ready()
  t.teardown(async () => { await w.close(); await r.close() })

  const seen = []
  const tail = r.tail()
  tail.on('data', e => seen.push(e.seq))
  tail.on('error', () => {})

  let cut = link(w, r)
  for (let i = 0; i < 5; i++) await w.append('step', { i })
  await r.waitFor(5)

  cut() // partition
  for (let i = 5; i < 25; i++) await w.append('step', { i })
  await sleep(100)
  t.is(r.length, 5, 'reader is stuck at 5 while partitioned')
  t.is(w.length, 25, 'writer keeps working while partitioned')

  cut = link(w, r) // heal
  await r.core.update({ wait: true })
  await r.waitFor(25)
  while (seen.length < 25) await sleep(10)
  t.alike(seen, Array.from({ length: 25 }, (_, i) => i), 'every event exactly once, in order')
  tail.destroy()
  cut()
})

test('repeated partitions converge', async t => {
  const w = await new TraceWriter(path.join(tmpdir(t), 'w')).ready()
  const r = await new TraceReader(path.join(tmpdir(t), 'r'), w.key).ready()
  t.teardown(async () => { await w.close(); await r.close() })
  for (let round = 0; round < 5; round++) {
    for (let i = 0; i < 3; i++) await w.append('step', { round, i })
    const cut = link(w, r)
    await r.core.update({ wait: true })
    await r.waitFor(w.length)
    cut()
  }
  t.is(r.length, 15)
  t.is(r.length, w.length)
})

test('crash-safe: a restarted writer continues the same run', async t => {
  const dir = tmpdir(t)
  let w = await new TraceWriter(dir, { name: 'job-1' }).ready()
  const key = w.key
  await w.append('run_start')
  await w.append('tool_call', { tool: 'fetch' })
  await w.close() // simulated crash/restart

  w = await new TraceWriter(dir, { name: 'job-1' }).ready()
  t.teardown(() => w.close())
  t.alike(w.key, key, 'same run key after restart')
  const e = await w.append('run_end', { status: 'ok' })
  t.is(e.seq, 2, 'sequence continues instead of restarting at 0')
})

test('summary counts tool calls, errors and final status', async t => {
  const now = Date.now()
  const s = summarize([
    { seq: 0, ts: now, type: 'run_start', data: {} },
    { seq: 1, ts: now + 50, type: 'tool_call', data: { tool: 'a' } },
    { seq: 2, ts: now + 80, type: 'error', data: { message: 'timeout' } },
    { seq: 3, ts: now + 90, type: 'tool_call', data: { tool: 'a', retry: 1 } },
    { seq: 4, ts: now + 120, type: 'run_end', data: { status: 'partial' } }
  ])
  t.is(s.events, 5)
  t.is(s.toolCalls, 2)
  t.is(s.errors, 1)
  t.is(s.status, 'partial')
  t.is(s.durationMs, 120)
})

test('summary of an unfinished run reports running', async t => {
  t.is(summarize([{ seq: 0, ts: 1, type: 'run_start', data: {} }]).status, 'running')
})
