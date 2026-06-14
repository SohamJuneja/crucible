import type { PublicClient } from 'viem'
import type { AgentClaim, VerificationResult, Verdict } from '@crucible/core'
import { decodeSwapFromLogs } from './decoders/swap.js'
import { decodeLendDepositFromLogs } from './decoders/lendDeposit.js'

// ── Verdict thresholds — single source of truth ───────────────────────────────
// VERIFIED:      |claimed − actual| / claimed ≤ TOLERANCE_PCT
// EXAGGERATED:   (claimed − actual) / claimed  > EXAGGERATION_PCT  (agent over-claimed)
// In between (TOLERANCE < delta ≤ EXAGGERATION): minor rounding/slippage → VERIFIED with note
// FALSE_CLAIM:   tx missing / failed / wrong tokens / no matching action
// UNVERIFIABLE:  action type not supported or insufficient log data
const TOLERANCE_PCT    = 0.02   // 2 %
const EXAGGERATION_PCT = 0.10   // 10 %

type RawLogs = Parameters<typeof decodeSwapFromLogs>[0]

export async function verifyClaim(
  claim: AgentClaim,
  publicClient: PublicClient,
): Promise<VerificationResult> {
  const derived: VerificationResult['derived'] = { txExists: false, txSuccess: false }

  // 1. Fetch receipt — sole source of ground truth
  let logs: RawLogs
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: claim.txHash })
    derived.txExists  = true
    derived.txSuccess = receipt.status === 'success'
    logs = receipt.logs as RawLogs
  } catch {
    return build(claim, 'FALSE_CLAIM', 0, derived, ['tx_not_found'])
  }

  if (!derived.txSuccess) {
    return build(claim, 'FALSE_CLAIM', 0, derived, ['tx_reverted'])
  }

  // 2. Dispatch to action decoder
  switch (claim.action) {
    case 'swap':        return verifySwap(claim, logs, derived)
    case 'lendDeposit': return verifyLendDeposit(claim, logs, derived)
    default:
      return build(claim, 'UNVERIFIABLE', 0, derived, [`unsupported_action:${claim.action}`])
  }
}

// ── action verifiers ──────────────────────────────────────────────────────────

function verifySwap(
  claim: AgentClaim,
  logs: RawLogs,
  derived: VerificationResult['derived'],
): VerificationResult {
  const swap = decodeSwapFromLogs(logs, claim.agentAddress)

  if (!swap) {
    return build(claim, 'FALSE_CLAIM', 0, derived, ['no_swap_transfers_found'])
  }

  derived.actualTokenIn  = swap.tokenIn
  derived.actualTokenOut = swap.tokenOut
  derived.actualAmountIn  = swap.amountIn
  derived.actualAmountOut = swap.amountOut

  // Token identity checks
  if (
    claim.params.tokenIn &&
    claim.params.tokenIn.toLowerCase() !== swap.tokenIn.toLowerCase()
  ) {
    return build(claim, 'FALSE_CLAIM', 0, derived, [
      `wrong_tokenIn:claimed=${claim.params.tokenIn} actual=${swap.tokenIn}`,
    ])
  }
  if (
    claim.params.tokenOut &&
    claim.params.tokenOut.toLowerCase() !== swap.tokenOut.toLowerCase()
  ) {
    return build(claim, 'FALSE_CLAIM', 0, derived, [
      `wrong_tokenOut:claimed=${claim.params.tokenOut} actual=${swap.tokenOut}`,
    ])
  }

  // No amount claimed — swap presence is enough
  if (!claim.params.amountOut) {
    return build(claim, 'VERIFIED', 1, derived, [])
  }

  return compareAmounts(
    claim,
    claim.params.amountOut,
    swap.amountOut,
    'amountOut',
    derived,
  )
}

function verifyLendDeposit(
  claim: AgentClaim,
  logs: RawLogs,
  derived: VerificationResult['derived'],
): VerificationResult {
  const deposit = decodeLendDepositFromLogs(logs, claim.agentAddress)

  if (!deposit) {
    return build(claim, 'FALSE_CLAIM', 0, derived, ['no_deposit_transfer_found'])
  }

  derived.actualTokenIn  = deposit.token
  derived.actualAmountIn = deposit.amount

  if (
    claim.params.tokenIn &&
    claim.params.tokenIn.toLowerCase() !== deposit.token.toLowerCase()
  ) {
    return build(claim, 'FALSE_CLAIM', 0, derived, [
      `wrong_tokenIn:claimed=${claim.params.tokenIn} actual=${deposit.token}`,
    ])
  }

  if (!claim.params.amountIn) {
    return build(claim, 'VERIFIED', 1, derived, [])
  }

  return compareAmounts(claim, claim.params.amountIn, deposit.amount, 'amountIn', derived)
}

// ── shared amount comparison ──────────────────────────────────────────────────

function compareAmounts(
  claim: AgentClaim,
  claimedStr: string,
  actualStr: string,
  field: string,
  derived: VerificationResult['derived'],
): VerificationResult {
  const claimed = BigInt(claimedStr)
  const actual  = BigInt(actualStr)

  if (claimed === 0n) {
    return build(claim, 'UNVERIFIABLE', 0, derived, [`claimed_${field}_is_zero`])
  }

  // truthScore ∈ [0,1]: ratio of actual to claimed, capped at 1
  const truthScore = Math.min(Number(actual) / Number(claimed), 1)
  const pctOver    = Math.max(0, 1 - truthScore)   // how much claimed exceeds actual

  if (pctOver <= TOLERANCE_PCT) {
    return build(claim, 'VERIFIED', truthScore, derived, [])
  }

  if (pctOver > EXAGGERATION_PCT) {
    return build(claim, 'EXAGGERATED', truthScore, derived, [
      `${field}_claimed_${(pctOver * 100).toFixed(1)}pct_above_actual:claimed=${claimedStr} actual=${actualStr}`,
    ])
  }

  // Between tolerance and exaggeration threshold — minor discrepancy
  return build(claim, 'VERIFIED', truthScore, derived, [
    `${field}_minor_discrepancy_${(pctOver * 100).toFixed(1)}pct:claimed=${claimedStr} actual=${actualStr}`,
  ])
}

// ── builder ───────────────────────────────────────────────────────────────────

function build(
  claim: AgentClaim,
  verdict: Verdict,
  truthScore: number,
  derived: VerificationResult['derived'],
  reasons: string[],
): VerificationResult {
  return { claim, verdict, truthScore, derived, reasons }
}
