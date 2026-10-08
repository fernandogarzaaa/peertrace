'use strict'
const Hyperswarm = require('hyperswarm')

/**
 * Join the swarm for a trace (writer or reader) and replicate with every peer.
 * Hyperswarm reconnects on its own after drops; Hypercore resumes from the
 * last verified block, so no event is lost or duplicated.
 */
async function joinSwarm (trace, { server = true, client = true, swarm = new Hyperswarm() } = {}) {
  swarm.on('connection', conn => {
    const stream = trace.replicate(conn)
    stream.on('error', () => {}) // a dropped peer is normal; replication resumes on reconnect
  })
  const discovery = swarm.join(trace.core.discoveryKey, { server, client })
  await discovery.flushed()
  return swarm
}

module.exports = { joinSwarm }
