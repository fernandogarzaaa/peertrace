// Emits a fake agent run as JSON lines. Try:
//   node examples/fake-agent.js | npx peertrace share
// then on another machine:  npx peertrace tail <key>
const steps = [
  ['run_start', { model: 'llama-3.2-1b', goal: 'summarize inbox' }],
  ['tool_call', { tool: 'gmail.search', args: { q: 'is:unread' } }],
  ['tool_result', { tool: 'gmail.search', count: 12 }],
  ['error', { message: 'timeout', tool: 'gmail.read', attempt: 1 }],
  ['tool_call', { tool: 'gmail.read', retry: 1 }],
  ['tool_result', { tool: 'gmail.read', ok: true }],
  ['run_end', { status: 'ok' }]
]
let i = 0
const timer = setInterval(() => {
  const [type, data] = steps[i++]
  process.stdout.write(JSON.stringify({ type, data }) + '\n')
  if (i === steps.length) clearInterval(timer)
}, 500)
