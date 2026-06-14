/**
 * UniswapV3-style Swap decoder.
 *
 * Covers: Agni Finance, FusionX V3, and any pool that emits
 *   Swap(address indexed sender, address indexed recipient,
 *        int256 amount0, int256 amount1,
 *        uint160 sqrtPriceX96, uint128 liquidity, int24 tick)
 *
 * Sign convention (pool's perspective):
 *   amount0 > 0 → pool receives token0 (user sells token0 → tokenIn = token0)
 *   amount0 < 0 → pool sends  token0 (user buys token0  → tokenOut = token0)
 *   (same for amount1)
 *
 * Token addresses come from ERC-20 Transfer events on the pool contract.
 */
import { type ProtocolDecodeResult, type RawLog, parseTransfer, int256 } from './types.js'

// keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)")
export const UNISWAP_V3_SWAP_TOPIC =
  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67' as const

export function decodeUniswapV3Swap(
  logs:         readonly RawLog[],
  _agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const swapLog = logs.find(
    l => l.topics[0]?.toLowerCase() === UNISWAP_V3_SWAP_TOPIC,
  )
  if (!swapLog) return null

  // data = abi.encode(int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liq, int24 tick)
  const data = swapLog.data.slice(2)
  if (data.length < 128) return null
  const amount0 = int256(data.slice(0,  64))
  const amount1 = int256(data.slice(64, 128))

  const poolAddress = swapLog.address.toLowerCase()

  // Token addresses from Transfer events on the pool
  let tokenIn:  `0x${string}` | undefined
  let tokenOut: `0x${string}` | undefined

  for (const log of logs) {
    const t = parseTransfer(log)
    if (!t || t.value === 0n) continue
    if (t.to.toLowerCase()   === poolAddress && !tokenIn)  tokenIn  = t.token
    if (t.from.toLowerCase() === poolAddress && !tokenOut) tokenOut = t.token
  }

  // V3 pool's amount0/amount1 cross-check:
  //   amount0 > 0 → pool receives token0 = tokenIn; amount0 < 0 → tokenOut
  //   amount1 > 0 → pool receives token1 = tokenIn; amount1 < 0 → tokenOut
  // Use event amounts for precision (Transfer amounts equal these for simple swaps).
  let amountIn:  string | undefined
  let amountOut: string | undefined

  if (amount0 > 0n && amount1 < 0n) {
    amountIn  = amount0.toString()
    amountOut = (-amount1).toString()
  } else if (amount1 > 0n && amount0 < 0n) {
    amountIn  = amount1.toString()
    amountOut = (-amount0).toString()
  } else {
    // Fallback: take absolute values from Transfers if sign convention is unusual
    amountIn  = amount0 > 0n ? amount0.toString() : amount1.toString()
    amountOut = amount0 < 0n ? (-amount0).toString() : (-amount1).toString()
  }

  return {
    protocol: 'Agni / UniswapV3',
    action:   'swap',
    tokenIn,
    amountIn,
    tokenOut,
    amountOut,
  }
}
