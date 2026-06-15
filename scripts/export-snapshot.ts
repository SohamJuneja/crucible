/**
 * export-snapshot.ts — regenerates apps/web/data/snapshot.json from the live
 * crucible-db.json plus the agent name/cohort maps in .seed-agents.json and
 * .extra-agents.json.
 *
 * Every agent and verification in crucible-db.json traces to a real on-chain tx.
 * Hand-written fake entries (e.g. former agents 201/202) are not re-inserted.
 *
 * Usage: npm run snapshot
 */
import fs from 'fs'
import path from 'path'
import { computeScore } from '@crucible/scoring'
import type { VerificationResult } from '@crucible/core'

// ── Paths ──────────────────────────────────────────────────────────────────────

const DB_PATH      = path.resolve(process.cwd(), 'crucible-db.json')
const SEED_STATE   = path.resolve(process.cwd(), '.seed-agents.json')
const EXTRA_STATE  = path.resolve(process.cwd(), '.extra-agents.json')
const ARTIFACTS    = path.resolve(process.cwd(), 'artifacts/deployed.json')
const SNAPSHOT_OUT = path.resolve(process.cwd(), 'apps/web/data/snapshot.json')

// Known vault address fallback (from artifacts/deployed.json — matches CLAUDE.md §3)
const VAULT_FALLBACK = {
  address:           '0xabf24c1356ec094858aba00c65ca258ddc2ee1cb',
  minScore:          6000,
  performanceFeeBps: 1000,
}

// ── Types ──────────────────────────────────────────────────────────────────────

interface RawDb {
  agents: Record<string, { walletAddress: string; score: number; updatedAt: number }>
  verifications: Array<{
    id:                   number
    agentId:              string
    txHash:               string
    verdict:              string
    truthScore:           number
    resultJson:           string
    evidenceUri:          string | null
    requestHash:          string | null
    validationTxHash:     string | null
    feedbackTxHash:       string | null
    scoreboardTxHash?:    string | null
    attestationSignature?: string | null
    createdAt:            number
  }>
}

// ── Main ───────────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`crucible-db.json not found at ${DB_PATH}`)
    console.error('Run `npm run seed` or `npm run seed:extra` first to populate it.')
    process.exit(1)
  }

  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as RawDb

  // ── Build name map and cohort map ──────────────────────────────────────────────
  const nameMap:   Record<string, string>   = {}
  const cohortMap: Record<string, 'human'>  = {}

  // Original 3 seed bots (.seed-agents.json: honest-bot, mediocre-bot, liar-bot)
  if (fs.existsSync(SEED_STATE)) {
    const seed = JSON.parse(fs.readFileSync(SEED_STATE, 'utf8')) as
      Record<string, { agentId?: string | null; privateKey: string; address: string }>
    for (const [name, agent] of Object.entries(seed)) {
      if (agent.agentId) nameMap[agent.agentId] = name
    }
  }

  // Extra agents (.extra-agents.json: human-alpha, human-beta, ai-alpha, ai-beta)
  if (fs.existsSync(EXTRA_STATE)) {
    const extra = JSON.parse(fs.readFileSync(EXTRA_STATE, 'utf8')) as
      Record<string, { agentId?: string | null; cohort: 'human' | 'ai' }>
    for (const [name, agent] of Object.entries(extra)) {
      if (agent.agentId) {
        nameMap[agent.agentId] = name
        if (agent.cohort === 'human') cohortMap[agent.agentId] = 'human'
      }
    }
  }

  // ── Vault metadata ─────────────────────────────────────────────────────────────
  let vault = VAULT_FALLBACK
  if (fs.existsSync(ARTIFACTS)) {
    const deployed = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as
      Record<string, { address?: string; minScore?: number; performanceFeeBps?: number } | undefined>
    const dv = deployed['DelegationVault']
    if (dv?.address) {
      vault = {
        address:           dv.address,
        minScore:          dv.minScore          ?? VAULT_FALLBACK.minScore,
        performanceFeeBps: dv.performanceFeeBps ?? VAULT_FALLBACK.performanceFeeBps,
      }
    }
  }

  // ── Assemble snapshot — named agents only, scores recomputed via computeScore ──
  // Unnamed agents (no entry in nameMap) are old throwaway test artifacts.
  // Only agents with a real persona name appear on the leaderboard.
  //
  // IMPORTANT: we do NOT copy the raw `score` from the DB. That value was written
  // by older ingest runs that may have lacked the FALSE_CLAIM hard cap. Instead we
  // re-derive every agent's score here using the same computeScore from @crucible/scoring
  // that the Arena's data.ts uses, so the snapshot, the CLI summary, and the UI all
  // agree on a single authoritative number.
  const namedIds      = new Set(Object.keys(nameMap))
  const verifications = db.verifications.filter(v => namedIds.has(v.agentId))

  function parseResults(agentId: string): VerificationResult[] {
    return verifications
      .filter(v => v.agentId === agentId)
      .map(v => { try { return JSON.parse(v.resultJson) as VerificationResult } catch { return null } })
      .filter((r): r is VerificationResult => r !== null)
  }

  const agents = Object.fromEntries(
    Object.entries(db.agents)
      .filter(([id]) => namedIds.has(id))
      .map(([id, raw]) => {
        const score = computeScore(parseResults(id))
        return [id, { ...raw, score }]
      })
  )

  const snapshot = { nameMap, cohortMap, vault, agents, verifications }

  fs.mkdirSync(path.dirname(SNAPSHOT_OUT), { recursive: true })
  fs.writeFileSync(SNAPSHOT_OUT, JSON.stringify(snapshot, null, 2))

  // ── Summary ────────────────────────────────────────────────────────────────────
  const humanAgentIds = Object.keys(cohortMap)
  const aiAgentIds    = Object.keys(agents).filter(id => !cohortMap[id as keyof typeof cohortMap])

  console.log(`\n✅ snapshot.json written → ${SNAPSHOT_OUT}`)
  console.log(`   Agents       : ${Object.keys(agents).length} named  (${aiAgentIds.length} AI, ${humanAgentIds.length} human)`)
  console.log(`   Verifications: ${verifications.length}`)
  console.log(`   Vault        : ${vault.address}`)
  console.log()

  console.log('   Agent roster:')
  for (const [agentId, agent] of Object.entries(agents)) {
    const name    = nameMap[agentId]!
    const cohort  = cohortMap[agentId as keyof typeof cohortMap] ?? 'ai'
    const verifs  = verifications.filter(v => v.agentId === agentId)
    const verdicts = verifs.map(v => v.verdict[0]).join('')
    const scoreStr = agent.score.toFixed(1)
    console.log(`   [${cohort.padEnd(5)}] ${name.padEnd(14)} id=${agentId.padEnd(5)}  score=${scoreStr.padStart(5)}  verifs(${verdicts || '—'})`)
  }

  // Cohort averages
  const avg = (ids: string[]) => ids.length
    ? ids.reduce((s, id) => s + agents[id].score, 0) / ids.length
    : 0
  console.log()
  console.log(`   AI avg   : ${avg(aiAgentIds).toFixed(1)}  (${aiAgentIds.length} agents)`)
  console.log(`   Human avg: ${avg(humanAgentIds).toFixed(1)}  (${humanAgentIds.length} agents)`)
}

main()
