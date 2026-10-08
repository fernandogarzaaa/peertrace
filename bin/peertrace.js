#!/usr/bin/env node
'use strict'
const os = require('os')
const path = require('path')
const readline = require('readline')
const { TraceWriter, TraceReader } = require('../lib')
const { joinSwarm } = require('../lib/swarm')

const HELP = `peertrace - share AI agent run logs peer-to-peer

  peertrace share [--name run] [--dir path]
      Read JSON lines {"type": "...", "data": {...}} from stdin, append them to a
      signed Hypercore log, and serve it on Hyperswarm. Prints the run key.

  peertrace tail <key> [--dir path]
      Connect to peers holding <key> and print events live, in order.

  peertrace summary <key> [--dir path] [--wait ms]
      Sync, then print a summary (events, tool calls, errors, status).
`

function flag (args, name, fallback) {
  const i = args.indexOf(name)
  return i === -1 ? fallback : args[i + 1]
}

async function main () {
  const [cmd, ...args] = process.argv.slice(2)
  const dir = flag(args, '--dir', path.join(os.homedir(), '.peertrace'))

  if (cmd === 'share') {
    const name = flag(args, '--name', 'run-' + Date.now())
    const w = await new TraceWriter(path.join(dir, 'writer'), { name }).ready()
    const swarm = await joinSwarm(w, { client: false })
    console.error(`run key: ${w.key.toString('hex')}`)
    const rl = readline.createInterface({ input: process.stdin })
    for await (const line of rl) {
      if (!line.trim()) continue
      try {
        const { type, data } = JSON.parse(line)
        await w.append(type, data)
      } catch (err) {
        await w.append('error', { message: 'unparseable input line', line })
      }
    }
    console.error(`${w.length} events recorded; still sharing (Ctrl+C to stop)`)
    process.once('SIGINT', async () => { await swarm.destroy(); await w.close(); process.exit(0) })
    return
  }

  if (cmd === 'tail' || cmd === 'summary') {
    const key = args[0]
    if (!key || !/^[0-9a-f]{64}$/i.test(key)) throw new Error('expected a 64-char hex run key')
    const r = await new TraceReader(path.join(dir, 'reader'), key).ready()
    const swarm = await joinSwarm(r, { server: false })
    const done = r.core.findingPeers()
    swarm.flush().then(done, done)
    await r.core.update({ wait: true })

    if (cmd === 'summary') {
      await new Promise(resolve => setTimeout(resolve, Number(flag(args, '--wait', 0))))
      console.log(JSON.stringify(await r.summary(), null, 2))
      await swarm.destroy(); await r.close()
      return
    }
    for await (const e of r.tail()) {
      console.log(`#${e.seq} ${new Date(e.ts).toISOString()} ${e.type} ${JSON.stringify(e.data)}`)
    }
    return
  }

  process.stdout.write(HELP)
  if (cmd && cmd !== 'help' && cmd !== '--help') process.exitCode = 1
}

main().catch(err => { console.error(err.message); process.exit(1) })
