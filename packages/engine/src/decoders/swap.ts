import { decodeAllTransfers, type RawLog } from './transfer.js'

export interface SwapResult {
  tokenIn:   `0x${string}`
  amountIn:  string
  tokenOut:  `0x${string}`
  amountOut: string
}

/**
 * Infers a swap from receipt Transfer events.
 *
 * Strategy: for a canonical DEX swap the agent:
 *   - sends tokenIn  → some router/pool   (Transfer with from == agentAddress)
 *   - receives tokenOut ← some router/pool (Transfer with to   == agentAddress, different token)
 *
 * When multiple out-transfers exist, we take the largest by value (most likely the intended swap).
 */
export function decodeSwapFromLogs(
  logs: readonly RawLog[],
  agentAddress: `0x${string}`,
): SwapResult | null {
  const transfers = decodeAllTransfers(logs)
  const agent = agentAddress.toLowerCase()

  // Tokens LEAVING agent — pick the largest-value one as tokenIn
  const outgoing = transfers
    .filter(t => t.from.toLowerCase() === agent && t.value > 0n)
    .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))

  const tokenInTransfer = outgoing[0]
  if (!tokenInTransfer) return null

  // Tokens ARRIVING at agent with a DIFFERENT contract address — pick first
  const incoming = transfers.filter(
    t =>
      t.to.toLowerCase() === agent &&
      t.token.toLowerCase() !== tokenInTransfer.token.toLowerCase() &&
      t.value > 0n,
  )

  const tokenOutTransfer = incoming[0]
  if (!tokenOutTransfer) return null

  return {
    tokenIn:   tokenInTransfer.token,
    amountIn:  tokenInTransfer.value.toString(),
    tokenOut:  tokenOutTransfer.token,
    amountOut: tokenOutTransfer.value.toString(),
  }
}
