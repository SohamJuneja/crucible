import type { VerificationResult } from '@crucible/core'

// ── Scoring constants — all knobs in one place ────────────────────────────────
const W = { riskReturn: 35, winRate: 20, consistency: 15, truthfulness: 30 } as const

// Exponential time-decay: results HALF_LIFE_DAYS old are weighted at 50 %
const HALF_LIFE_DAYS = 3

// Per-component truthfulness cap when FALSE_CLAIM is present
// (still applied before the final hard cap below)
const FALSE_CLAIM_TRUTH_CAP = 0.30

// Hard cap on the TOTAL score per FALSE_CLAIM (Crucible's core differentiator).
// One fabrication → cap 35.  Each additional lie drops it 10 more (floor 5).
//   falseClaimCount = 1 → cap = max(5, 35 - 10*(1-1)) = 35
//   falseClaimCount = 2 → cap = max(5, 35 - 10) = 25
//   falseClaimCount = 3 → cap = 15 … floor at 5
const FALSE_CLAIM_CAP_BASE  = 35
const FALSE_CLAIM_CAP_STEP  = 10
const FALSE_CLAIM_CAP_FLOOR = 5

// ── Public API ────────────────────────────────────────────────────────────────

export function computeScore(history: VerificationResult[]): number {
  if (history.length === 0) return 0

  const now    = Date.now()
  const halfMs = HALF_LIFE_DAYS * 24 * 60 * 60 * 1_000

  const w = history.map(r => {
    const ageMs = Math.max(0, now - new Date(r.claim.timestamp).getTime())
    return Math.exp(-Math.LN2 * ageMs / halfMs)
  })
  const wSum = w.reduce((a, b) => a + b, 0)

  const falseClaimCount = history.filter(r => r.verdict === 'FALSE_CLAIM').length
  const hasFalseClaim   = falseClaimCount > 0

  // ── 1. Truthfulness (30 pts) ───────────────────────────────────────────────
  const rawTruth    = w.reduce((s, wi, i) => s + wi * history[i].truthScore, 0) / wSum
  const truthfulness = hasFalseClaim ? Math.min(rawTruth, FALSE_CLAIM_TRUTH_CAP) : rawTruth

  // ── 2. Win rate (20 pts) — verdictable only, UNVERIFIABLE excluded ─────────
  const verdictable = history.filter(r => r.verdict !== 'UNVERIFIABLE')
  const vwSum       = verdictable.reduce((s, r) => s + w[history.indexOf(r)], 0)
  const vwVerified  = verdictable
    .filter(r => r.verdict === 'VERIFIED')
    .reduce((s, r) => s + w[history.indexOf(r)], 0)
  const winRate = vwSum > 0 ? vwVerified / vwSum : 0

  // ── 3. Risk-adjusted return (35 pts) — Sharpe-like; FALSE_CLAIM PnL = 0 ───
  const pnlItems = history.filter(r => r.verdict === 'VERIFIED' || r.verdict === 'EXAGGERATED')
  let riskReturn = 0
  if (pnlItems.length > 0) {
    const pVals  = pnlItems.map(r => r.truthScore)
    const pW     = pnlItems.map(r => w[history.indexOf(r)])
    const pWSum  = pW.reduce((a, b) => a + b, 0)
    const mean   = pVals.reduce((s, v, i) => s + v * pW[i], 0) / pWSum

    if (pnlItems.length === 1) {
      riskReturn = Math.max(0, mean)
    } else {
      const variance = pVals.reduce((s, v, i) => s + (v - mean) ** 2 * pW[i], 0) / pWSum
      const std      = Math.sqrt(Math.max(variance, 1e-9))
      riskReturn     = Math.max(0, Math.min(1, (mean / std + 1) / 2))
    }
  }

  // ── 4. Consistency (15 pts) — 1 − maxDrawdown/normalizer ─────────────────
  let consistency = 0.5
  if (pnlItems.length >= 2) {
    const series = pnlItems.map(r => r.truthScore)
    let peak = series[0]; let maxDD = 0
    for (const v of series) {
      if (v > peak) peak = v
      maxDD = Math.max(maxDD, peak - v)
    }
    const mean     = series.reduce((a, b) => a + b, 0) / series.length
    const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length
    consistency    = Math.max(0, Math.min(1, 1 - maxDD / Math.max(variance + 0.05, 0.1)))
  }

  // ── Weighted sum ───────────────────────────────────────────────────────────
  const rawScore =
    W.riskReturn   * riskReturn   +
    W.winRate      * winRate      +
    W.consistency  * consistency  +
    W.truthfulness * truthfulness

  // ── FALSE_CLAIM hard cap — career-damaging, non-negotiable ────────────────
  // Any fabrication is punished by an absolute ceiling, regardless of the agent's
  // otherwise-good record.  The more lies, the lower the ceiling.
  const cap = hasFalseClaim
    ? Math.max(FALSE_CLAIM_CAP_FLOOR, FALSE_CLAIM_CAP_BASE - FALSE_CLAIM_CAP_STEP * (falseClaimCount - 1))
    : 100

  return Math.max(0, Math.min(cap, rawScore))
}
