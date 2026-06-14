import type { VerificationResult } from '@crucible/core'

// ── Scoring constants — all knobs in one place ────────────────────────────────
const W = { riskReturn: 35, winRate: 20, consistency: 15, truthfulness: 30 } as const

// Exponential time-decay: results HALF_LIFE_DAYS old are weighted at 50 %
const HALF_LIFE_DAYS = 3

// Hard cap on truthfulness when ANY FALSE_CLAIM is present.
// Even a perfect agent: truthfulness ≤ this fraction → max 30 * 0.30 = 9 pts from truth.
const FALSE_CLAIM_TRUTH_CAP = 0.30

// ── Public API ────────────────────────────────────────────────────────────────

export function computeScore(history: VerificationResult[]): number {
  if (history.length === 0) return 0

  const now   = Date.now()
  const halfMs = HALF_LIFE_DAYS * 24 * 60 * 60 * 1_000

  // per-result time-decay weights
  const w = history.map(r => {
    const ageMs = Math.max(0, now - new Date(r.claim.timestamp).getTime())
    return Math.exp(-Math.LN2 * ageMs / halfMs)
  })
  const wSum = w.reduce((a, b) => a + b, 0)

  const hasFalseClaim = history.some(r => r.verdict === 'FALSE_CLAIM')

  // ── 1. Truthfulness (30 pts) ──────────────────────────────────────────────
  const rawTruth = w.reduce((s, wi, i) => s + wi * history[i].truthScore, 0) / wSum
  // Single FALSE_CLAIM: hard-cap so liars can never outscore honest agents
  const truthfulness = hasFalseClaim ? Math.min(rawTruth, FALSE_CLAIM_TRUTH_CAP) : rawTruth

  // ── 2. Win rate (20 pts) — verdictable only, UNVERIFIABLE excluded ─────────
  const verdictable = history.filter(r => r.verdict !== 'UNVERIFIABLE')
  const vwSum = verdictable.reduce((s, r) => s + w[history.indexOf(r)], 0)
  const vwVerified = verdictable
    .filter(r => r.verdict === 'VERIFIED')
    .reduce((s, r) => s + w[history.indexOf(r)], 0)
  const winRate = vwSum > 0 ? vwVerified / vwSum : 0

  // ── 3. Risk-adjusted return (35 pts) — Sharpe-like; FALSE_CLAIM PnL = 0 ───
  const pnlItems = history.filter(r => r.verdict === 'VERIFIED' || r.verdict === 'EXAGGERATED')
  let riskReturn = 0
  if (pnlItems.length > 0) {
    const pVals = pnlItems.map(r => r.truthScore) // 1 = fully realized, <1 = partial/exaggerated
    const pW    = pnlItems.map(r => w[history.indexOf(r)])
    const pWSum = pW.reduce((a, b) => a + b, 0)
    const mean  = pVals.reduce((s, v, i) => s + v * pW[i], 0) / pWSum

    if (pnlItems.length === 1) {
      riskReturn = Math.max(0, mean)
    } else {
      const variance = pVals.reduce((s, v, i) => s + (v - mean) ** 2 * pW[i], 0) / pWSum
      const std = Math.sqrt(Math.max(variance, 1e-9))
      // Sharpe → [0,1]: Sharpe of 0 ≈ 0.5, negative < 0.5, high > 0.5
      riskReturn = Math.max(0, Math.min(1, (mean / std + 1) / 2))
    }
  }

  // ── 4. Consistency (15 pts) — 1 − maxDrawdown/normalizer ──────────────────
  let consistency = 0.5  // neutral default for ≤1 data point
  if (pnlItems.length >= 2) {
    const series   = pnlItems.map(r => r.truthScore)
    let peak = series[0]; let maxDD = 0
    for (const v of series) {
      if (v > peak) peak = v
      maxDD = Math.max(maxDD, peak - v)
    }
    const mean = series.reduce((a, b) => a + b, 0) / series.length
    const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / series.length
    consistency = Math.max(0, Math.min(1, 1 - maxDD / Math.max(variance + 0.05, 0.1)))
  }

  // ── Weighted sum ───────────────────────────────────────────────────────────
  const score =
    W.riskReturn   * riskReturn   +
    W.winRate      * winRate      +
    W.consistency  * consistency  +
    W.truthfulness * truthfulness

  return Math.max(0, Math.min(100, score))
}
