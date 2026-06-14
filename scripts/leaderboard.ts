/**
 * leaderboard.ts — pure local leaderboard, zero on-chain calls, zero trades.
 *
 * Reads the local crucible-db.json store, recomputes each agent's current reputation
 * with computeScore(fullHistory), and prints the board sorted by that score.
 *
 * Usage: npm run leaderboard
 */
import fs from 'fs'
import path from 'path'
import { computeScore } from '@crucible/scoring'
import { getAgentHistory } from '@crucible/indexer'

const DB_PATH   = path.resolve(process.cwd(), 'crucible-db.json')
const SEED_PATH = path.resolve(process.cwd(), '.seed-agents.json')

interface Store {
  agents: Record<string, { walletAddress: string; score: number; updatedAt: number }>
}

interface SeedState {
  [bot: string]: { privateKey: string; address: string; agentId: string | null }
}

function main(): void {
  if (!fs.existsSync(DB_PATH)) {
    console.error('crucible-db.json not found — run: npm run seed  or  npm run ingest:demo')
    process.exit(1)
  }

  const store: Store = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))
  const agentIds = Object.keys(store.agents)

  if (agentIds.length === 0) {
    console.log('Local store is empty. Run: npm run seed')
    return
  }

  // Build human-readable name map from .seed-agents.json (if present)
  const nameMap: Record<string, string> = {}
  if (fs.existsSync(SEED_PATH)) {
    const seed: SeedState = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8'))
    for (const [name, agent] of Object.entries(seed)) {
      if (agent.agentId) nameMap[agent.agentId] = name
    }
  }

  // Recompute reputation score from full verdict history for every agent
  const rows = agentIds.map(agentId => {
    const history     = getAgentHistory(agentId)
    const score       = computeScore(history)
    const verdicts    = history.map(r => r.verdict)
    const verifiedN   = verdicts.filter(v => v === 'VERIFIED').length
    const exagN       = verdicts.filter(v => v === 'EXAGGERATED').length
    const falseN      = verdicts.filter(v => v === 'FALSE_CLAIM').length
    const lastVerdict = history.at(-1)?.verdict ?? '—'
    const name        = nameMap[agentId] ?? `agent-${agentId}`
    return { agentId, name, score, trades: history.length, verifiedN, exagN, falseN, lastVerdict }
  })

  // Sort by recomputed score descending
  rows.sort((a, b) => b.score - a.score)

  // ── Print table ─────────────────────────────────────────────────────────────
  const C = [5, 16, 10, 7, 9, 6, 6, 15, 14]
  const headers = ['Rank', 'Name', 'AgentId', 'Trades', 'Verified', 'Exag', 'False', 'Last Verdict', 'Score (local)']
  const divider = C.map(w => '─'.repeat(w)).join('─┼─')

  console.log('\n╔══ CRUCIBLE LEADERBOARD ══════════════════════════════════════════════════════╗')
  console.log(`  ${headers.map((h, i) => h.padEnd(C[i])).join(' │ ')}`)
  console.log(`  ${divider}`)

  rows.forEach((r, i) => {
    const icon = r.falseN > 0 ? '🚨' : r.exagN > 0 ? '≈' : '✓'
    const cols = [
      `#${i + 1}`.padEnd(C[0]),
      r.name.padEnd(C[1]),
      r.agentId.padEnd(C[2]),
      String(r.trades).padEnd(C[3]),
      String(r.verifiedN).padEnd(C[4]),
      String(r.exagN).padEnd(C[5]),
      String(r.falseN).padEnd(C[6]),
      (`${icon} ${r.lastVerdict}`).padEnd(C[7] + 2),
      r.score.toFixed(2),
    ]
    console.log(`  ${cols.join(' │ ')}`)
  })

  console.log('╚══════════════════════════════════════════════════════════════════════════════╝')
  console.log('\n  Ranking: computeScore(full verdict history) — no on-chain reads, no writes.')
  console.log('  Score cap: 35 per FALSE_CLAIM (−10 each, floor 5).  Run "npm run seed" to add verdicts.\n')
}

main()
