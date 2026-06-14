import { describe, it, expect } from 'vitest'
import { computeScore } from '../computeScore'
import type { VerificationResult, Verdict } from '@crucible/core'

// ── helpers ───────────────────────────────────────────────────────────────────

let seq = 0
function makeResult(verdict: Verdict, truthScore: number): VerificationResult {
  return {
    claim: {
      agentId:      '1',
      agentAddress: '0x0000000000000000000000000000000000000001',
      action:       'swap',
      txHash:       `0x${String(++seq).padStart(64, '0')}` as `0x${string}`,
      params:       {},
      timestamp:    new Date().toISOString(),
    },
    verdict,
    truthScore,
    derived: { txExists: true, txSuccess: true },
    reasons: [],
  }
}

const verified    = () => makeResult('VERIFIED',    1)
const exaggerated = () => makeResult('EXAGGERATED', 0.75)   // 25% below claim — clear exaggeration
const falseClaim  = () => makeResult('FALSE_CLAIM', 0)

// ── tests ──────────────────────────────────────────────────────────────────────

describe('computeScore', () => {
  it('returns 0 for empty history', () => {
    expect(computeScore([])).toBe(0)
  })

  it('all-VERIFIED history yields a positive score ≤ 100', () => {
    const score = computeScore([verified(), verified(), verified()])
    console.log('all-VERIFIED score:', score.toFixed(2))
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThanOrEqual(100)
  })

  it('strict ordering: honest > exaggerator > liar', () => {
    const honestScore     = computeScore([verified(),    verified(),    verified(),    verified(),    verified()])
    const exaggeratorScore = computeScore([exaggerated(), exaggerated(), exaggerated(), exaggerated(), exaggerated()])
    const liarScore       = computeScore([verified(),    verified(),    verified(),    verified(),    falseClaim()])

    console.log({ honestScore: honestScore.toFixed(2), exaggeratorScore: exaggeratorScore.toFixed(2), liarScore: liarScore.toFixed(2) })

    expect(honestScore).toBeGreaterThan(exaggeratorScore)
    expect(exaggeratorScore).toBeGreaterThan(liarScore)
  })

  it('any history with FALSE_CLAIM scores below any reasonable history without one', () => {
    // Liar with a strong VERIFIED record — still capped by FALSE_CLAIM penalty
    const strongLiar = computeScore([
      verified(), verified(), verified(), verified(), verified(),
      verified(), verified(), verified(), verified(), falseClaim(),
    ])
    // A single mediocre exaggerated trade (no false claims)
    const singleExaggerated = computeScore([exaggerated()])

    console.log({ strongLiar: strongLiar.toFixed(2), singleExaggerated: singleExaggerated.toFixed(2) })

    expect(strongLiar).toBeLessThan(singleExaggerated)
  })

  it('FALSE_CLAIM hard cap is at most 35 regardless of other verdicts', () => {
    const liarWithPerfectRecord = computeScore([
      verified(), verified(), verified(), verified(), verified(),
      verified(), verified(), verified(), verified(), verified(),
      falseClaim(),
    ])
    console.log('liar with perfect record, capped:', liarWithPerfectRecord.toFixed(2))
    expect(liarWithPerfectRecord).toBeLessThanOrEqual(35)
  })

  it('each additional FALSE_CLAIM lowers the cap by 10', () => {
    const oneLie   = computeScore([verified(), verified(), falseClaim()])
    const twoLies  = computeScore([verified(), verified(), falseClaim(), falseClaim()])
    const threeLies = computeScore([verified(), verified(), falseClaim(), falseClaim(), falseClaim()])

    console.log({ oneLie: oneLie.toFixed(2), twoLies: twoLies.toFixed(2), threeLies: threeLies.toFixed(2) })

    // Caps: 35, 25, 15 — score should respect those ceilings
    expect(oneLie).toBeLessThanOrEqual(35)
    expect(twoLies).toBeLessThanOrEqual(25)
    expect(threeLies).toBeLessThanOrEqual(15)
    // More lies → equal or lower score
    expect(twoLies).toBeLessThanOrEqual(oneLie)
    expect(threeLies).toBeLessThanOrEqual(twoLies)
  })
})
