/**
 * Protocol decoder registry.
 *
 * `decodeProtocol` scans a receipt's log set for a known protocol event topic
 * and returns a typed ProtocolDecodeResult.  Returns null when no recognized
 * protocol event is present — the caller should fall back to the universal
 * ERC-20 Transfer decoder.
 *
 * Priority order matters when a tx might contain multiple protocol events
 * (e.g. a swap inside a lending tx): more specific decoders are listed first.
 */
import { type RawLog, type ProtocolDecodeResult, type ProtocolDecoderFn } from './types.js'
import { UNISWAP_V2_SWAP_TOPIC, decodeUniswapV2Swap } from './uniswapV2.js'
import { UNISWAP_V3_SWAP_TOPIC, decodeUniswapV3Swap } from './uniswapV3.js'
import {
  AAVE_V2_DEPOSIT_TOPIC,  decodeAaveV2Deposit,
  AAVE_V2_WITHDRAW_TOPIC, decodeAaveV2Withdraw,
} from './aaveV2.js'
import {
  INIT_CAPITAL_MINT_TOPIC, decodeInitCapitalMint,
  INIT_CAPITAL_BURN_TOPIC, decodeInitCapitalBurn,
} from './initCapital.js'

// ── Registry ──────────────────────────────────────────────────────────────────

interface RegistryEntry {
  topic0:  string
  decoder: ProtocolDecoderFn
}

const REGISTRY: RegistryEntry[] = [
  // Lending (more specific — check before generic swap)
  { topic0: AAVE_V2_DEPOSIT_TOPIC,   decoder: decodeAaveV2Deposit  },
  { topic0: AAVE_V2_WITHDRAW_TOPIC,  decoder: decodeAaveV2Withdraw },
  { topic0: INIT_CAPITAL_MINT_TOPIC, decoder: decodeInitCapitalMint },
  { topic0: INIT_CAPITAL_BURN_TOPIC, decoder: decodeInitCapitalBurn },
  // DEX swaps
  { topic0: UNISWAP_V3_SWAP_TOPIC,   decoder: decodeUniswapV3Swap  },
  { topic0: UNISWAP_V2_SWAP_TOPIC,   decoder: decodeUniswapV2Swap  },
]

/** Returns the matched topic0 strings for informational display / testing. */
export const ALL_KNOWN_TOPICS = REGISTRY.map(e => e.topic0)

/**
 * Auto-selects a decoder from the receipt logs.
 * Returns null when no known protocol event is found → fall back to Transfer inference.
 */
export function decodeProtocol(
  logs:         readonly RawLog[],
  agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const presentTopics = new Set(logs.map(l => l.topics[0]?.toLowerCase()).filter(Boolean))

  for (const { topic0, decoder } of REGISTRY) {
    if (presentTopics.has(topic0.toLowerCase())) {
      const result = decoder(logs, agentAddress)
      if (result) return result
    }
  }
  return null
}

export type { ProtocolDecodeResult } from './types.js'
