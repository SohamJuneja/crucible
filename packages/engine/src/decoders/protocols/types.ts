export interface RawLog {
  address: `0x${string}`
  topics:  readonly `0x${string}`[]
  data:    `0x${string}`
}

export interface ProtocolDecodeResult {
  protocol:   string                        // human-readable name, e.g. "Agni (UniswapV3)"
  action:     'swap' | 'lendDeposit' | 'lendWithdraw'
  tokenIn?:   `0x${string}`
  amountIn?:  string                        // base-unit bigint as string
  tokenOut?:  `0x${string}`
  amountOut?: string
}

/** A protocol decoder receives all logs and the agent's address, returns a decoded
 *  action or null if this protocol's event is not present in the logs. */
export type ProtocolDecoderFn = (
  logs:         readonly RawLog[],
  agentAddress: `0x${string}`,
) => ProtocolDecodeResult | null

// ── Common log helpers ────────────────────────────────────────────────────────

export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const

/** Parse an ERC-20 Transfer log into typed fields. */
export function parseTransfer(log: RawLog): {
  token: `0x${string}`
  from:  `0x${string}`
  to:    `0x${string}`
  value: bigint
} | null {
  if (
    log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC ||
    log.topics.length < 3
  ) return null
  return {
    token: log.address,
    from:  `0x${log.topics[1]!.slice(-40)}` as `0x${string}`,
    to:    `0x${log.topics[2]!.slice(-40)}` as `0x${string}`,
    value: log.data === '0x' ? 0n : BigInt(log.data),
  }
}

/** Convert int256 hex (big-endian, two's-complement) to signed bigint. */
export function int256(hex64: string): bigint {
  const v = BigInt('0x' + hex64)
  return v >= 2n ** 255n ? v - 2n ** 256n : v
}

/** Address from a padded 32-byte topic (last 20 bytes). */
export function addrFromTopic(topic: string): `0x${string}` {
  return `0x${topic.slice(-40)}` as `0x${string}`
}
