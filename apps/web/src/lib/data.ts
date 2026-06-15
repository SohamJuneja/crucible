/**
 * Server-side data access — reads from the committed snapshot bundle.
 * All functions run only on the server (called from Server Components / route handlers).
 */
import { computeScore } from '@crucible/scoring'
import type { VerificationResult } from '@crucible/core'
import snapshot from '../../data/snapshot.json'

// ── Raw store types (mirrors packages/indexer/src/db.ts) ──────────────────────

interface RawStore {
  agents: Record<string, { walletAddress: string; score: number; updatedAt: number }>
  verifications: RawVerification[]
}

interface RawVerification {
  id:               number
  agentId:          string
  txHash:           string
  verdict:          string
  truthScore:       number
  resultJson:       string
  evidenceUri:      string | null
  requestHash:      string | null
  validationTxHash: string | null
  feedbackTxHash:   string | null
  createdAt:        number
}

// ── Public types ───────────────────────────────────────────────────────────────

export interface AgentData {
  agentId:          string
  name:             string
  address:          string
  cohort:           'ai' | 'human'
  score:            number
  trades:           number
  verifiedCount:    number
  exaggeratedCount: number
  falseClaimCount:  number
  unverifiableCount: number
  truthfulness:     number   // mean truthScore across all verdicts [0,1]
  lastVerdict:      string | null
  lastVerdictAt:    number | null
}

export interface ReceiptData {
  id:              number
  agentId:         string
  agentName:       string
  txHash:          string
  verdict:         string
  truthScore:      number
  action:          string
  timestamp:       string
  claimedTokenIn:  string | undefined
  claimedTokenOut: string | undefined
  claimedAmountIn: string | undefined
  claimedAmountOut:string | undefined
  actualTokenIn:   string | undefined
  actualTokenOut:  string | undefined
  actualAmountIn:  string | undefined
  actualAmountOut: string | undefined
  txExists:        boolean
  txSuccess:       boolean
  reasons:         string[]
  evidenceUri:     string | null
  validationTxHash:string | null
  createdAt:       number
}

// ── Store loading ──────────────────────────────────────────────────────────────

function loadStore(): RawStore {
  return {
    agents:        snapshot.agents        as unknown as RawStore['agents'],
    verifications: snapshot.verifications as unknown as RawVerification[],
  }
}

function loadNameMap(): Record<string, string> {
  return snapshot.nameMap as Record<string, string>
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function parseResult(raw: RawVerification): VerificationResult | null {
  try { return JSON.parse(raw.resultJson) as VerificationResult }
  catch { return null }
}

function buildAgentData(
  agentId: string,
  rawAgent: RawStore['agents'][string],
  verifs: RawVerification[],
  nameMap: Record<string, string>,
): AgentData {
  const name   = nameMap[agentId] ?? `agent-${agentId}`
  const cohort: 'ai' | 'human' =
    (snapshot.cohortMap as Record<string, string>)[agentId] === 'human' ? 'human' : 'ai'

  const results = verifs.map(parseResult).filter((r): r is VerificationResult => r !== null)
  const score   = computeScore(results)

  const verifiedCount    = verifs.filter(v => v.verdict === 'VERIFIED').length
  const exaggeratedCount = verifs.filter(v => v.verdict === 'EXAGGERATED').length
  const falseClaimCount  = verifs.filter(v => v.verdict === 'FALSE_CLAIM').length
  const unverifiableCount = verifs.filter(v => v.verdict === 'UNVERIFIABLE').length

  const truthfulness = results.length > 0
    ? results.reduce((s, r) => s + r.truthScore, 0) / results.length
    : 0

  const sorted = [...verifs].sort((a, b) => b.createdAt - a.createdAt)

  return {
    agentId,
    name,
    address: rawAgent.walletAddress,
    cohort,
    score,
    trades: verifs.length,
    verifiedCount,
    exaggeratedCount,
    falseClaimCount,
    unverifiableCount,
    truthfulness,
    lastVerdict: sorted[0]?.verdict ?? null,
    lastVerdictAt: sorted[0]?.createdAt ?? null,
  }
}

function buildReceipt(raw: RawVerification, agentName: string): ReceiptData | null {
  const result = parseResult(raw)
  if (!result) return null
  const { claim, derived } = result
  return {
    id:               raw.id,
    agentId:          raw.agentId,
    agentName,
    txHash:           raw.txHash,
    verdict:          raw.verdict,
    truthScore:       raw.truthScore,
    action:           claim.action,
    timestamp:        claim.timestamp,
    claimedTokenIn:   claim.params.tokenIn,
    claimedTokenOut:  claim.params.tokenOut,
    claimedAmountIn:  claim.params.amountIn,
    claimedAmountOut: claim.params.amountOut,
    actualTokenIn:    derived.actualTokenIn,
    actualTokenOut:   derived.actualTokenOut,
    actualAmountIn:   derived.actualAmountIn,
    actualAmountOut:  derived.actualAmountOut,
    txExists:         derived.txExists,
    txSuccess:        derived.txSuccess,
    reasons:          result.reasons,
    evidenceUri:      raw.evidenceUri,
    validationTxHash: raw.validationTxHash,
    createdAt:        raw.createdAt,
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function getLeaderboardData(): AgentData[] {
  const store   = loadStore()
  const nameMap = loadNameMap()
  const rows: AgentData[] = []

  for (const [agentId, rawAgent] of Object.entries(store.agents)) {
    const verifs = store.verifications.filter(v => v.agentId === agentId)
    rows.push(buildAgentData(agentId, rawAgent, verifs, nameMap))
  }

  return rows.sort((a, b) => b.score - a.score)
}

export function getVerificationFeed(limit = 20): ReceiptData[] {
  const store   = loadStore()
  const nameMap = loadNameMap()
  return store.verifications
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(v => buildReceipt(v, nameMap[v.agentId] ?? `agent-${v.agentId}`))
    .filter((r): r is ReceiptData => r !== null)
}

export function getAgentData(agentId: string): AgentData | null {
  const store   = loadStore()
  const nameMap = loadNameMap()
  const rawAgent = store.agents[agentId]
  if (!rawAgent) return null
  const verifs = store.verifications.filter(v => v.agentId === agentId)
  return buildAgentData(agentId, rawAgent, verifs, nameMap)
}

export interface ScoreBreakdown {
  riskReturn:    number   // pts out of 35
  winRate:       number   // pts out of 20
  consistency:   number   // pts out of 15
  truthfulness:  number   // pts out of 30
  rawTotal:      number
  finalScore:    number
  cap:           number
  hasFalse:      boolean
  falseClaimCount: number
}

export function getScoreBreakdown(agentId: string): ScoreBreakdown | null {
  const store  = loadStore()
  const verifs = store.verifications.filter(v => v.agentId === agentId)
  if (!verifs.length) return null

  const results = verifs.map(parseResult).filter((r): r is VerificationResult => r !== null)

  const now    = Date.now()
  const halfMs = 3 * 24 * 60 * 60 * 1_000
  const w      = results.map(r => {
    const ageMs = Math.max(0, now - new Date(r.claim.timestamp).getTime())
    return Math.exp(-Math.LN2 * ageMs / halfMs)
  })
  const wSum = w.reduce((a, b) => a + b, 0)

  const falseClaimCount = results.filter(r => r.verdict === 'FALSE_CLAIM').length
  const hasFalse        = falseClaimCount > 0

  const rawTruth    = w.reduce((s, wi, i) => s + wi * results[i].truthScore, 0) / wSum
  const tfFraction  = hasFalse ? Math.min(rawTruth, 0.30) : rawTruth

  const verdictable = results.filter(r => r.verdict !== 'UNVERIFIABLE')
  const vwSum       = verdictable.reduce((s, r) => s + w[results.indexOf(r)], 0)
  const vwVerified  = verdictable.filter(r => r.verdict === 'VERIFIED')
    .reduce((s, r) => s + w[results.indexOf(r)], 0)
  const winRateFrac = vwSum > 0 ? vwVerified / vwSum : 0

  const pnlItems = results.filter(r => r.verdict === 'VERIFIED' || r.verdict === 'EXAGGERATED')
  let riskReturnFrac = 0
  if (pnlItems.length) {
    const pVals = pnlItems.map(r => r.truthScore)
    const pW    = pnlItems.map(r => w[results.indexOf(r)])
    const pWSum = pW.reduce((a, b) => a + b, 0)
    const mean  = pVals.reduce((s, v, i) => s + v * pW[i], 0) / pWSum
    if (pnlItems.length === 1) {
      riskReturnFrac = Math.max(0, mean)
    } else {
      const variance = pVals.reduce((s, v, i) => s + (v - mean) ** 2 * pW[i], 0) / pWSum
      const std = Math.sqrt(Math.max(variance, 1e-9))
      riskReturnFrac = Math.max(0, Math.min(1, (mean / std + 1) / 2))
    }
  }

  let consFrac = 0.5
  if (pnlItems.length >= 2) {
    const series = pnlItems.map(r => r.truthScore)
    let peak = series[0]; let maxDD = 0
    for (const v of series) { if (v > peak) peak = v; maxDD = Math.max(maxDD, peak - v) }
    const mean = series.reduce((a, b) => a + b, 0) / series.length
    const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length
    consFrac = Math.max(0, Math.min(1, 1 - maxDD / Math.max(variance + 0.05, 0.1)))
  }

  const cap      = hasFalse ? Math.max(5, 35 - 10 * (falseClaimCount - 1)) : 100
  const riskReturn   = 35 * riskReturnFrac
  const winRatePts   = 20 * winRateFrac
  const consPts      = 15 * consFrac
  const truthPts     = 30 * tfFraction
  const rawTotal     = riskReturn + winRatePts + consPts + truthPts
  const finalScore   = Math.max(0, Math.min(cap, rawTotal))

  return { riskReturn, winRate: winRatePts, consistency: consPts, truthfulness: truthPts, rawTotal, finalScore, cap, hasFalse, falseClaimCount }
}

export function getAgentReceipts(agentId: string): ReceiptData[] {
  const store   = loadStore()
  const nameMap = loadNameMap()
  const name    = nameMap[agentId] ?? `agent-${agentId}`
  return store.verifications
    .filter(v => v.agentId === agentId)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(v => buildReceipt(v, name))
    .filter((r): r is ReceiptData => r !== null)
}

export function getHumanVsAI(): {
  ai:    { count: number; avgScore: number; agents: AgentData[] }
  human: { count: number; avgScore: number; agents: AgentData[] }
} {
  const all = getLeaderboardData()
  const ai    = all.filter(a => a.cohort === 'ai')
  const human = all.filter(a => a.cohort === 'human')
  const avg   = (arr: AgentData[]) => arr.length ? arr.reduce((s, a) => s + a.score, 0) / arr.length : 0
  return {
    ai:    { count: ai.length,    avgScore: avg(ai),    agents: ai },
    human: { count: human.length, avgScore: avg(human), agents: human },
  }
}

// ── Utility exports ────────────────────────────────────────────────────────────

export function ipfsToGateway(uri: string | null): string | null {
  if (!uri) return null
  if (uri.startsWith('ipfs://')) return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`
  return uri  // file:// or https:// as-is
}

export function shortAddr(addr: string): string {
  if (addr.length < 12) return addr
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function fmtAmount(raw: string | undefined): string {
  if (!raw) return '—'
  try {
    const n = Number(BigInt(raw)) / 1e18
    return n.toFixed(4)
  } catch {
    return raw
  }
}

export function timeAgo(unixSec: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixSec
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
