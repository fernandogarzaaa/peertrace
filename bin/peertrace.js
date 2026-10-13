#!/usr/bin/env node
'use strict'
const os = require('os')
const path = require('path')
const readline = require('readline')
const Hyperswarm = require('hyperswarm')
const { TraceWriter, TraceReader } = require('../lib')
const { joinSwarm } = require('../lib/swarm')
const { parseArgs, parseBootstrap, parseMs, toEvent, waitForPeer } = require('../lib/cli')

const HELP = `peertrace - share AI agent run logs peer-to-peer

  peertrace share [--name run] [--dir path]
      Read JSON lines {"type": "...", "data": {...}} from stdin, append them to a
      signed Hypercore log, and serve it on Hyperswarm. Prints the run key.

  peertrace tail <key> [--dir path]
      Connect to peers holding <key> and print events live, in order.

  peertrace summary <key> [--dir path] [--wait ms] [--timeout ms]
      Sync, then print a summary (events, tool calls, errors, status).
      Waits up to --timeout ms (default 15000) for a peer holding the run and
      exits with code 2 if none is reachable.

  Options for all commands:
      --bootstrap host:port[,host:port]   use a private/test DHT instead of the public one
`

async function main () {
  const argv = process.argv.slice(2)
  if (!argv.length || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP)
    return
  }
  const { cmd, flags, positional } = parseArgs(argv)
  const dir = flags.dir || path.join(os.homedir(), '.peertrace')
  const bootstrap = parseBootstrap(flags.bootstrap)
  const newSwarm = () => new Hyperswarm(bootstrap ? { bootstrap } : {})

  if (cmd === 'share') {
    const name = flags.name || 'run-' + Date.now()
    const w = await new TraceWriter(path.join(dir, 'writer'), { name }).ready()
    const swarm = await joinSwarm(w, { client: false, swarm: newSwarm() })
    console.error(`run key: ${w.key.toString('hex')}`)
    const rl = readline.createInterface({ input: process.stdin })
    for await (const line of rl) {
      if (!line.trim()) continue
      let ev = null
      let reason = 'not valid JSON'
      try {
        ev = toEvent(JSON.parse(line))
        if (!ev) reason = 'expected an object with a non-empty string "type"'
      } catch {}
      if (ev) await w.append(ev[0], ev[1])
      else await w.append('error', { message: `unparseable input line: ${reason}`, line })
    }
    console.error(`${w.length} events recorded; still sharing (Ctrl+C to stop)`)
    process.once('SIGINT', async () => { await swarm.destroy(); await w.close(); process.exit(0) })
    return
  }

  if (cmd === 'tail' || cmd === 'summary') {
    const key = positional[0]
    if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('expected a 64-char hex run key')
    const wait = parseMs(flags.wait, '--wait', 0)
    const timeout = parseMs(flags.timeout, '--timeout', 15000)
    const r = await new TraceReader(path.join(dir, 'reader'), key).ready()
    const swarm = await joinSwarm(r, { server: false, swarm: newSwarm() })

    if (cmd === 'summary') {
      // Discovery can finish before the peer connection and replication handshake do,
      // so wait for an actual replicating peer before trusting the local length.
      if (r.length === 0) await waitForPeer(r.core, timeout)
      await r.core.update({ wait: true })
      await new Promise(resolve => setTimeout(resolve, wait))
      if (r.length === 0) {
        console.error(`no events found for run ${key}: no peer holding it was reachable within ${timeout} ms (is the writer still sharing?)`)
        process.exitCode = 2
      } else {
        console.log(JSON.stringify(await r.summary(), null, 2))
      }
      await swarm.destroy(); await r.close()
      return
    }

    const done = r.core.findingPeers()
    swarm.flush().then(done, done)
    await r.core.update({ wait: true })
    for await (const e of r.tail()) {
      console.log(`#${e.seq} ${new Date(e.ts).toISOString()} ${e.type} ${JSON.stringify(e.data)}`)
    }
    return
  }

  process.stderr.write(`unknown command: ${cmd}\n\n` + HELP)
  process.exitCode = 1
}

main().catch(err => { console.error(err.message); process.exit(1) })
