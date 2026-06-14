/**
 * UniswapV2-style Swap decoder.
 *
 * Covers: FusionX V2, Merchant Moe V1 AMM, and any other pair that emits
 *   Swap(address indexed sender, uint256 amount0In, uint256 amount1In,
 *        uint256 amount0Out, uint256 amount1Out, address indexed to)
 *
 * Strategy:
 *   - Parse amounts directly from the Swap event (ground truth).
 *   - Identify token addresses from ERC-20 Transfer events on the pair contract.
 */
import { type ProtocolDecodeResult, type RawLog, parseTransfer } from './types.js'

// keccak256("Swap(address,uint256,uint256,uint256,uint256,address)")
export const UNISWAP_V2_SWAP_TOPIC =
  '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822' as const

export function decodeUniswapV2Swap(
  logs:         readonly RawLog[],
  _agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const swapLog = logs.find(
    l => l.topics[0]?.toLowerCase() === UNISWAP_V2_SWAP_TOPIC,
  )
  if (!swapLog) return null

  // Parse amounts: data = abi.encode(amount0In, amount1In, amount0Out, amount1Out)
  const data = swapLog.data.slice(2)  // strip 0x
  if (data.length < 256) return null
  const amount0In  = BigInt('0x' + data.slice(0,   64))
  const amount1In  = BigInt('0x' + data.slice(64,  128))
  const amount0Out = BigInt('0x' + data.slice(128, 192))
  const amount1Out = BigInt('0x' + data.slice(192, 256))

  const pairAddress = swapLog.address.toLowerCase()

  // Find tokenIn: Transfer whose `to` is the pair (user pays into pool)
  // Find tokenOut: Transfer whose `from` is the pair (pool pays user)
  let tokenIn:  `0x${string}` | undefined
  let tokenOut: `0x${string}` | undefined

  for (const log of logs) {
    const t = parseTransfer(log)
    if (!t || t.value === 0n) continue
    if (t.to.toLowerCase()   === pairAddress && !tokenIn)  tokenIn  = t.token
    if (t.from.toLowerCase() === pairAddress && !tokenOut) tokenOut = t.token
  }

  // Determine amounts from which slot was non-zero
  const amountIn  = (amount0In  > 0n ? amount0In  : amount1In).toString()
  const amountOut = (amount0Out > 0n ? amount0Out : amount1Out).toString()

  return {
    protocol: 'FusionX V2 / UniswapV2',
    action:   'swap',
    tokenIn,
    amountIn,
    tokenOut,
    amountOut,
  }
}
