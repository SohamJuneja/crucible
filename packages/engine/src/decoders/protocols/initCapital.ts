/**
 * Init Capital lending decoder.
 *
 * Init Capital (https://app.initcapital.org) is a natively cross-margined
 * lending protocol on Mantle mainnet.  Their pool tokens emit a Mint event
 * when liquidity is deposited:
 *
 *   Mint(address indexed to, uint256 shares, uint256 amt)
 *
 * The `amt` field is the underlying asset deposited; `shares` is the pool
 * token minted.  The underlying asset address is the pool token contract's
 * `underlyingToken()`, which we infer from ERC-20 Transfer events (the
 * user transfers the underlying to the pool before Mint fires).
 *
 * Source: Init Capital IPool interface
 *   https://github.com/init-capital/init-capital-contracts
 */
import { type ProtocolDecodeResult, type RawLog, parseTransfer, addrFromTopic } from './types.js'

// keccak256("Mint(address,uint256,uint256)")
export const INIT_CAPITAL_MINT_TOPIC =
  '0x4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f' as const

// keccak256("Burn(address,uint256,uint256,address)")
export const INIT_CAPITAL_BURN_TOPIC =
  '0x49995e5dd6158cf69ad3e9777c46755a1a826a446c6416992167462dad033b2a' as const

export function decodeInitCapitalMint(
  logs:         readonly RawLog[],
  _agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const mintLog = logs.find(l => l.topics[0]?.toLowerCase() === INIT_CAPITAL_MINT_TOPIC)
  if (!mintLog) return null

  // topics[1] = indexed `to` (recipient of pool shares)
  // data = abi.encode(uint256 shares, uint256 amt) — 2 × 32 bytes
  const data = mintLog.data.slice(2)
  if (data.length < 128) return null
  const amt = BigInt('0x' + data.slice(64, 128)).toString()

  // Infer underlying token: the ERC-20 Transfer TO the pool contract
  // (user transfers underlying in; pool contract is the mintLog.address)
  const poolAddress = mintLog.address.toLowerCase()
  let tokenIn: `0x${string}` | undefined
  for (const log of logs) {
    const t = parseTransfer(log)
    if (!t || t.value === 0n) continue
    if (t.to.toLowerCase() === poolAddress) { tokenIn = t.token; break }
  }

  return {
    protocol: 'Init Capital',
    action:   'lendDeposit',
    tokenIn,
    amountIn: amt,
  }
}

export function decodeInitCapitalBurn(
  logs:         readonly RawLog[],
  _agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const burnLog = logs.find(l => l.topics[0]?.toLowerCase() === INIT_CAPITAL_BURN_TOPIC)
  if (!burnLog) return null

  // data = abi.encode(uint256 shares, uint256 amt, address to) — 2×32 + 32 bytes
  const data = burnLog.data.slice(2)
  if (data.length < 192) return null
  const amt = BigInt('0x' + data.slice(64, 128)).toString()

  // Infer underlying token: Transfer FROM pool to user
  const poolAddress = burnLog.address.toLowerCase()
  let tokenOut: `0x${string}` | undefined
  for (const log of logs) {
    const t = parseTransfer(log)
    if (!t || t.value === 0n) continue
    if (t.from.toLowerCase() === poolAddress) { tokenOut = t.token; break }
  }

  return {
    protocol:  'Init Capital',
    action:    'lendWithdraw',
    tokenOut,
    amountOut: amt,
  }
}
