// ── Known-good contract addresses on Mantle Sepolia ──────────────────────────
// Add MockDEX / token addresses at runtime via addToAllowlist() or the
// extraAllowlist option on assessIntent().

const CANONICAL: string[] = [
  '0x8004a818bfb912233c491871b3d84c89a494bd9e', // ERC-8004 IdentityRegistry
  '0x8004b663056a597dffe9eccc1965a193b7388713', // ERC-8004 ReputationRegistry
]

export const BASE_ALLOWLIST = new Set<string>(CANONICAL)

/** Permanently add an address to the module-level allowlist. */
export function addToAllowlist(address: string): void {
  BASE_ALLOWLIST.add(address.toLowerCase())
}

// ── Risk score contributions ─ (all scoring constants here) ──────────────────
export const RISK = {
  UNKNOWN_CONTRACT:  20,  // `to` not in allowlist
  UNLIMITED_APPROVE: 60,  // approve ≥ 2^128 tokens to unknown spender
  DRAIN_TRANSFER:    70,  // transfer >50% of token balance OR >abs threshold to unknown
  OVERSIZED_VALUE:   50,  // native MNT value > 1 MNT
  SIM_REVERT:        10,  // pre-execution simulation reverts (additive only)
} as const

// ── Decision thresholds ────────────────────────────────────────────────────
export const BLOCK_THRESHOLD = 60   // riskScore ≥ 60 → BLOCK
export const WARN_THRESHOLD  = 20   // riskScore ≥ 20 → WARN
// riskScore < 20 → ALLOW

// ── Absolute thresholds ────────────────────────────────────────────────────
/** Transfers of this amount or above are flagged as potential drains even when
 *  we cannot read the agent's token balance (network fallback). */
export const LARGE_TRANSFER_THRESHOLD = 100n * 10n ** 18n  // 100 tokens

/** Any approve ≥ this is treated as "unlimited". Covers MaxUint256, 2^128, etc. */
export const UNLIMITED_THRESHOLD = 2n ** 128n               // ≈ 3.4×10^38 tokens

/** Native value above this is suspicious for a DeFi tx (most swaps use 0). */
export const NATIVE_VALUE_THRESHOLD = 10n ** 18n            // 1 MNT
