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
const exaggerated = () => makeResult('EXAGGERATED', 0.7)
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

  it('EXAGGERATED lowers score vs identical VERIFIED history', () => {
    const honest      = computeScore([verified(), verified(), verified()])
    const exaggerator = computeScore([exaggerated(), exaggerated(), exaggerated()])
    console.log({ honest: honest.toFixed(2), exaggerator: exaggerator.toFixed(2) })
    expect(exaggerator).toBeLessThan(honest)
  })

  it('liar (one FALSE_CLAIM, same PnL) scores strictly below honest agent', () => {
    const honestHistory = [
      verified(), verified(), verified(), verified(), verified(),
    ]
    // same four VERIFIED trades, then one FALSE_CLAIM
    const lyingHistory = [
      verified(), verified(), verified(), verified(), falseClaim(),
    ]

    const honestScore = computeScore(honestHistory)
    const lyingScore  = computeScore(lyingHistory)

    console.log({
      honestScore:  honestScore.toFixed(2),
      lyingScore:   lyingScore.toFixed(2),
      penaltyDelta: (honestScore - lyingScore).toFixed(2),
    })

    // Core invariant: a lying agent must NEVER outscore an honest one
    expect(lyingScore).toBeLessThan(honestScore)
    // The gap must be substantial (>= 15 pts) — truthfulness cap alone gives ~21 pts difference
    expect(honestScore - lyingScore).toBeGreaterThanOrEqual(15)
  })
})
