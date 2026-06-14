import type { PublicClient } from 'viem'
import type { AgentClaim, VerificationResult, Verdict } from '@crucible/core'
import { decodeSwapFromLogs } from './decoders/swap.js'
import { decodeLendDepositFromLogs } from './decoders/lendDeposit.js'
import { decodeProtocol } from './decoders/protocols/index.js'

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

  // 2. Protocol decoder: try to identify the DeFi protocol from event signatures.
  //    If matched, use its richer derived data; otherwise fall back to Transfer inference.
  const protocolResult = decodeProtocol(logs, claim.agentAddress)
  if (protocolResult) {
    derived.protocol = protocolResult.protocol
  }

  // 3. Dispatch to action verifier
  switch (claim.action) {
    case 'swap':
      return verifySwap(claim, logs, derived, protocolResult ?? undefined)
    case 'lendDeposit':
      return verifyLendDeposit(claim, logs, derived, protocolResult ?? undefined)
    default:
      return build(claim, 'UNVERIFIABLE', 0, derived, [`unsupported_action:${claim.action}`])
  }
}

// ── action verifiers ──────────────────────────────────────────────────────────

function verifySwap(
  claim:    AgentClaim,
  logs:     RawLogs,
  derived:  VerificationResult['derived'],
  protocol?: ReturnType<typeof decodeProtocol>,
): VerificationResult {
  // Prefer protocol-specific amounts (more precise for V3); fall back to ERC-20 Transfer inference
  let tokenIn:   string | undefined
  let tokenOut:  string | undefined
  let amountIn:  string | undefined
  let amountOut: string | undefined

  if (protocol?.action === 'swap') {
    tokenIn   = protocol.tokenIn
    tokenOut  = protocol.tokenOut
    amountIn  = protocol.amountIn
    amountOut = protocol.amountOut
  } else {
    const swap = decodeSwapFromLogs(logs, claim.agentAddress)
    if (!swap) {
      return build(claim, 'FALSE_CLAIM', 0, derived, ['no_swap_transfers_found'])
    }
    tokenIn   = swap.tokenIn
    tokenOut  = swap.tokenOut
    amountIn  = swap.amountIn
    amountOut = swap.amountOut
  }

  if (!tokenIn || !tokenOut) {
    return build(claim, 'UNVERIFIABLE', 0, derived, ['could_not_identify_swap_tokens'])
  }

  derived.actualTokenIn   = tokenIn
  derived.actualTokenOut  = tokenOut
  derived.actualAmountIn  = amountIn
  derived.actualAmountOut = amountOut

  // Token identity checks
  if (claim.params.tokenIn && claim.params.tokenIn.toLowerCase() !== tokenIn.toLowerCase()) {
    return build(claim, 'FALSE_CLAIM', 0, derived, [
      `wrong_tokenIn:claimed=${claim.params.tokenIn} actual=${tokenIn}`,
    ])
  }
  if (claim.params.tokenOut && claim.params.tokenOut.toLowerCase() !== tokenOut.toLowerCase()) {
    return build(claim, 'FALSE_CLAIM', 0, derived, [
      `wrong_tokenOut:claimed=${claim.params.tokenOut} actual=${tokenOut}`,
    ])
  }

  if (!claim.params.amountOut || !amountOut) {
    return build(claim, 'VERIFIED', 1, derived, [])
  }

  return compareAmounts(claim, claim.params.amountOut, amountOut, 'amountOut', derived)
}

function verifyLendDeposit(
  claim:    AgentClaim,
  logs:     RawLogs,
  derived:  VerificationResult['derived'],
  protocol?: ReturnType<typeof decodeProtocol>,
): VerificationResult {
  let tokenIn:  string | undefined
  let amountIn: string | undefined

  if (protocol?.action === 'lendDeposit') {
    tokenIn  = protocol.tokenIn
    amountIn = protocol.amountIn
  } else {
    const deposit = decodeLendDepositFromLogs(logs, claim.agentAddress)
    if (!deposit) {
      return build(claim, 'FALSE_CLAIM', 0, derived, ['no_deposit_transfer_found'])
    }
    tokenIn  = deposit.token
    amountIn = deposit.amount
  }

  if (!tokenIn) {
    return build(claim, 'UNVERIFIABLE', 0, derived, ['could_not_identify_deposit_token'])
  }

  derived.actualTokenIn  = tokenIn
  derived.actualAmountIn = amountIn

  if (claim.params.tokenIn && claim.params.tokenIn.toLowerCase() !== tokenIn.toLowerCase()) {
    return build(claim, 'FALSE_CLAIM', 0, derived, [
      `wrong_tokenIn:claimed=${claim.params.tokenIn} actual=${tokenIn}`,
    ])
  }

  if (!claim.params.amountIn || !amountIn) {
    return build(claim, 'VERIFIED', 1, derived, [])
  }

  return compareAmounts(claim, claim.params.amountIn, amountIn, 'amountIn', derived)
}

// ── shared amount comparison ──────────────────────────────────────────────────

function compareAmounts(
  claim:      AgentClaim,
  claimedStr: string,
  actualStr:  string,
  field:      string,
  derived:    VerificationResult['derived'],
): VerificationResult {
  const claimed = BigInt(claimedStr)
  const actual  = BigInt(actualStr)

  if (claimed === 0n) {
    return build(claim, 'UNVERIFIABLE', 0, derived, [`claimed_${field}_is_zero`])
  }

  const truthScore = Math.min(Number(actual) / Number(claimed), 1)
  const pctOver    = Math.max(0, 1 - truthScore)

  if (pctOver <= TOLERANCE_PCT) {
    return build(claim, 'VERIFIED', truthScore, derived, [])
  }

  if (pctOver > EXAGGERATION_PCT) {
    return build(claim, 'EXAGGERATED', truthScore, derived, [
      `${field}_claimed_${(pctOver * 100).toFixed(1)}pct_above_actual:claimed=${claimedStr} actual=${actualStr}`,
    ])
  }

  return build(claim, 'VERIFIED', truthScore, derived, [
    `${field}_minor_discrepancy_${(pctOver * 100).toFixed(1)}pct:claimed=${claimedStr} actual=${actualStr}`,
  ])
}

// ── builder ───────────────────────────────────────────────────────────────────

function build(
  claim:      AgentClaim,
  verdict:    Verdict,
  truthScore: number,
  derived:    VerificationResult['derived'],
  reasons:    string[],
): VerificationResult {
  return { claim, verdict, truthScore, derived, reasons }
}
