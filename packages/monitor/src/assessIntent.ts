/**
 * assessIntent — pre-trade risk engine.
 *
 * Decodes the intended calldata, runs a pre-execution simulation, applies
 * anomaly rules, and returns a ALLOW / WARN / BLOCK decision.
 *
 * Trust boundary: all rule logic is deterministic.  The simulation call is
 * best-effort — a revert only adds risk when other rules already flagged the
 * intent.  Network unavailability never turns a safe intent into BLOCK.
 */
import type { PublicClient } from 'viem'
import { type Intent, type RiskAssessment, type Decision } from './types.js'
import { decodeCall } from './callDecoder.js'
import {
  BASE_ALLOWLIST,
  RISK, BLOCK_THRESHOLD, WARN_THRESHOLD,
  LARGE_TRANSFER_THRESHOLD, UNLIMITED_THRESHOLD, NATIVE_VALUE_THRESHOLD,
} from './allowlist.js'

// Minimal ABI for balanceOf — used in drain detection
const BALANCEOF_ABI = [
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs:  [{ name: 'account', type: 'address' }],
    outputs: [{ name: '',        type: 'uint256' }],
  },
] as const

export interface AssessOptions {
  /** Additional addresses to treat as known-good for this specific assessment
   *  (e.g. MockDEX and token addresses loaded from fixtures at runtime). */
  extraAllowlist?: Set<string>
}

/** Minimal publicClient surface used by assessIntent (allows lightweight mocking in tests). */
export type AssessClient = Pick<PublicClient, 'call' | 'readContract'>

export async function assessIntent(
  intent:  Intent,
  client:  AssessClient,
  options?: AssessOptions,
): Promise<RiskAssessment> {
  const reasons: string[] = []
  let riskScore = 0

  function allowed(addr: string): boolean {
    const a = addr.toLowerCase()
    return BASE_ALLOWLIST.has(a) || (options?.extraAllowlist?.has(a) ?? false)
  }

  const decoded = decodeCall(intent.data)

  // ── Rule 1: Interaction with unknown contract ──────────────────────────────
  // Rationale: agents should only interact with audited/allowlisted contracts.
  if (!allowed(intent.to)) {
    riskScore += RISK.UNKNOWN_CONTRACT
    reasons.push(`unknown_contract:${intent.to}`)
  }

  // ── Rule 2: Unlimited ERC-20 approve to untrusted spender ─────────────────
  // Rationale: MaxUint256 approve to an unrecognised address is the #1 phishing
  // vector — a compromised agent could drain the wallet at any future time.
  if (decoded?.type === 'approve' && decoded.to && decoded.amount !== undefined) {
    if (decoded.amount >= UNLIMITED_THRESHOLD && !allowed(decoded.to)) {
      riskScore += RISK.UNLIMITED_APPROVE
      reasons.push(`unlimited_approve_to_untrusted_spender:${decoded.to}`)
    }
  }

  // ── Rule 3: Drain pattern ──────────────────────────────────────────────────
  // Flags a transfer to an unknown address that either:
  //   (a) exceeds the absolute LARGE_TRANSFER_THRESHOLD, OR
  //   (b) moves >50% of the agent's on-chain token balance.
  if ((decoded?.type === 'transfer' || decoded?.type === 'transferFrom') && decoded.to) {
    if (!allowed(decoded.to)) {
      const amount = decoded.amount ?? 0n
      let isDrain = amount >= LARGE_TRANSFER_THRESHOLD  // (a) absolute guard

      if (!isDrain && amount > 0n) {
        try {
          const balance = await (client as PublicClient).readContract({
            address:      intent.to,
            abi:          BALANCEOF_ABI,
            functionName: 'balanceOf',
            args:         [intent.agentAddress],
          }) as bigint
          if (balance > 0n && amount * 2n > balance) isDrain = true  // (b) relative guard
        } catch {
          // Can't read balance — rely on absolute threshold only
        }
      }

      if (isDrain) {
        riskScore += RISK.DRAIN_TRANSFER
        reasons.push(`drain_pattern:transfer_${amount}_to_untrusted:${decoded.to}`)
      }
    }
  }

  // ── Rule 4: Oversized native MNT value ────────────────────────────────────
  // Most DeFi swaps transfer 0 native value; large MNT sends to unknown
  // contracts are suspicious.
  if (intent.value && intent.value > NATIVE_VALUE_THRESHOLD) {
    if (!allowed(intent.to)) {
      riskScore += RISK.OVERSIZED_VALUE
      reasons.push(`oversized_native_value:${intent.value}wei_to_unknown_contract`)
    }
  }

  // ── Pre-execution simulation (best-effort) ────────────────────────────────
  // Adds confidence that the tx would succeed; only penalises when another
  // rule already flagged the intent (pure reverts ≠ malicious).
  try {
    await (client as PublicClient).call({
      to:      intent.to,
      data:    intent.data,
      value:   intent.value,
      account: intent.agentAddress,
    })
  } catch {
    if (riskScore > 0) {
      riskScore += RISK.SIM_REVERT
      reasons.push('simulation_reverts')
    }
  }

  const decision: Decision =
    riskScore >= BLOCK_THRESHOLD ? 'BLOCK' :
    riskScore >= WARN_THRESHOLD  ? 'WARN'  :
    'ALLOW'

  return { decision, riskScore: Math.min(100, riskScore), reasons }
}
