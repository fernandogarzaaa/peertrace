# peertrace

Share AI agent run logs peer-to-peer. No server, no account, no upload.

Each agent run is a signed, append-only [Hypercore](https://github.com/holepunchto/hypercore) log. Anyone with the run's public key can tail it live over [Hyperswarm](https://github.com/holepunchto/hyperswarm), from any network, and verify that every event really came from the agent that wrote it.

Built for local AI: when the model runs on your own machine, its traces shouldn't have to leave for someone else's cloud just so a teammate can debug it.

```
# machine A: run an agent, stream its events into a P2P log
node examples/fake-agent.js | npx peertrace share
# run key: 3f9c...e1

# machine B: watch it live
npx peertrace tail 3f9c...e1
#0 2026-10-08T02:10:01.120Z run_start {"model":"llama-3.2-1b","goal":"summarize inbox"}
#1 2026-10-08T02:10:01.622Z tool_call {"tool":"gmail.search","args":{"q":"is:unread"}}
#3 ...                      error {"message":"timeout","tool":"gmail.read","attempt":1}

npx peertrace summary 3f9c...e1
# { "events": 7, "toolCalls": 2, "errors": 1, "status": "ok", ... }
```

## Library

```js
const { TraceWriter, TraceReader } = require('peertrace')
const { joinSwarm } = require('peertrace/lib/swarm')

const run = await new TraceWriter('./traces', { name: 'job-42' }).ready()
await joinSwarm(run)
await run.append('tool_call', { tool: 'search', args: { q: 'hypercore' } })
console.log(run.key.toString('hex')) // share this

const view = await new TraceReader('./mirror', key).ready()
await joinSwarm(view, { server: false })
for await (const event of view.tail()) console.log(event)
```

## Design decisions

- **Hypercore, not a database or a message queue.** An agent trace is naturally append-only. Hypercore gives ordering, signatures and sparse replication for free, so readers verify every event against the run's key and can't forge or reorder history.
- **One core per run.** Keys are the access control: share a run by sharing its key, and nothing else leaks.
- **Sequence numbers come from the log.** `seq` is the log length at append time, so a crashed and restarted writer (same storage, same `name`) continues the same run instead of starting a new one at 0.
- **Designed for partitions.** Writers never block on readers. While peers are disconnected, the writer keeps appending locally; on reconnect, Hypercore resumes from the last verified block and the live tail delivers every missed event exactly once, in order. The test suite cuts the connection mid-run to prove it.
- **Bad input is recorded, not dropped.** An unparseable line becomes an `error` event, so the trace shows the failure instead of silently losing it.

## Tests

```
npm test
```

Ten tests, including:

- a network partition in the middle of a live tail (20 events written while cut off, then caught up with no gaps or duplicates)
- five partition and heal cycles converging to the same length
- writer restart continuing the same run and sequence
- readers being unable to append to someone else's run
- an end-to-end run over real Hyperswarm on a local DHT testnet

## Event shape

```json
{ "seq": 3, "ts": 1791425401120, "type": "tool_call", "data": { "tool": "search" } }
```

Types are free-form. `run_start`, `tool_call`, `tool_result`, `error` and `run_end` (with `data.status`) feed the summary.

## License

MIT
