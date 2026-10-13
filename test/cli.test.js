'use strict'
const test = require('brittle')
const path = require('path')
const { spawn } = require('child_process')
const createTestnet = require('hyperdht/testnet')
const { parseArgs, parseBootstrap, parseMs, toEvent } = require('../lib/cli')
const { tmpdir } = require('./helpers')

const BIN = path.join(__dirname, '..', 'bin', 'peertrace.js')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function run (args, { input } = {}) {
  const p = spawn(process.execPath, [BIN, ...args])
  const out = { stdout: '', stderr: '' }
  p.stdout.on('data', d => { out.stdout += d })
  p.stderr.on('data', d => { out.stderr += d })
  if (input !== undefined) p.stdin.end(input)
  out.p = p
  out.done = new Promise(resolve => p.on('close', code => resolve({ code, stdout: out.stdout, stderr: out.stderr })))
  return out
}

test('parseArgs: flags before or after the run key', t => {
  const key = 'a'.repeat(64)
  t.alike(parseArgs(['tail', '--dir', '/x', key]), { cmd: 'tail', flags: { dir: '/x' }, positional: [key] })
  t.alike(parseArgs(['tail', key, '--dir', '/x']), { cmd: 'tail', flags: { dir: '/x' }, positional: [key] })
  t.exception(() => parseArgs(['tail', key, '--dir']), /--dir needs a value/)
  t.exception(() => parseArgs(['tail', key, '--dri', 'x']), /unknown option --dri/)
})

test('parseBootstrap and parseMs validate input', t => {
  t.alike(parseBootstrap('127.0.0.1:49737,localhost:1'), [{ host: '127.0.0.1', port: 49737 }, { host: 'localhost', port: 1 }])
  t.is(parseBootstrap(undefined), undefined)
  t.exception(() => parseBootstrap('nohost'), /bad --bootstrap/)
  t.exception(() => parseBootstrap('h:99999'), /bad --bootstrap/)
  t.is(parseMs(undefined, '--wait', 0), 0)
  t.is(parseMs('250', '--wait', 0), 250)
  t.exception(() => parseMs('soon', '--wait', 0), /--wait must be a non-negative/)
})

test('toEvent accepts only objects with a string type', t => {
  t.alike(toEvent({ type: 'tool_call', data: { a: 1 } }), ['tool_call', { a: 1 }])
  t.alike(toEvent({ type: 'run_start' }), ['run_start', {}])
  t.is(toEvent({ type: 5 }), null)
  t.is(toEvent(null), null)
  t.is(toEvent([1]), null)
  t.is(toEvent('x'), null)
})

test('cli: share then summary over a local DHT; bad lines become error events', async t => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const bs = testnet.bootstrap.map(b => `${b.host}:${b.port}`).join(',')
  const lines = [
    JSON.stringify({ type: 'run_start', data: { model: 'm' } }),
    JSON.stringify({ type: 'tool_call', data: { tool: 'x' } }),
    'not json',
    JSON.stringify({ type: 5 }),
    JSON.stringify({ type: 'run_end', data: { status: 'ok' } })
  ].join('\n') + '\n'
  const share = run(['share', '--dir', tmpdir(t), '--bootstrap', bs], { input: lines })
  t.teardown(() => share.p.kill('SIGKILL'))
  for (let i = 0; i < 300 && !/still sharing/.test(share.stderr); i++) await sleep(100)
  const key = (share.stderr.match(/[0-9a-f]{64}/) || [])[0]
  t.ok(key, 'share printed a run key')

  const res = await run(['summary', key, '--dir', tmpdir(t), '--bootstrap', bs]).done
  t.is(res.code, 0, res.stderr)
  const s = JSON.parse(res.stdout)
  t.is(s.events, 5)
  t.is(s.errors, 2)
  t.is(s.status, 'ok')
})

test('cli: summary of an unreachable run exits 2 instead of printing an empty summary', async t => {
  const testnet = await createTestnet(3, { teardown: t.teardown })
  const bs = testnet.bootstrap.map(b => `${b.host}:${b.port}`).join(',')
  const res = await run(['summary', 'c'.repeat(64), '--dir', tmpdir(t), '--bootstrap', bs, '--timeout', '1500']).done
  t.is(res.code, 2)
  t.is(res.stdout, '')
  t.ok(/no peer holding it was reachable/.test(res.stderr))
})

test('cli: unknown command exits 1', async t => {
  const res = await run(['bogus']).done
  t.is(res.code, 1)
  t.ok(/unknown command/.test(res.stderr))
})
