/**
 * Aave V2-style lending decoder.
 *
 * Covers: Lendle (Aave V2 fork on Mantle mainnet — LendingPool
 *         0xcfa5ae7c2ce8fadc6426c1ff872ca45378fb7cf3)
 *
 * Events decoded:
 *   Deposit(address indexed reserve, address user,
 *           address indexed onBehalfOf, uint256 amount, uint16 indexed referral)
 *
 *   Withdraw(address indexed reserve, address indexed user,
 *            address indexed to, uint256 amount)
 */
import { type ProtocolDecodeResult, type RawLog, addrFromTopic } from './types.js'

// keccak256("Deposit(address,address,address,uint256,uint16)")
export const AAVE_V2_DEPOSIT_TOPIC =
  '0xde6857219544bb5b7746f48ed30be6386fefc61b2f864cacf559893bf50fd951' as const

// keccak256("Withdraw(address,address,address,uint256)")
export const AAVE_V2_WITHDRAW_TOPIC =
  '0x3115d1449a7b732c986cba18244e897a450f61e1bb8d589cd2e69e6c8924f9f7' as const

export function decodeAaveV2Deposit(
  logs: readonly RawLog[],
  _agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const log = logs.find(l => l.topics[0]?.toLowerCase() === AAVE_V2_DEPOSIT_TOPIC)
  if (!log) return null

  // topics[1] = indexed reserve = asset being deposited
  const reserve = addrFromTopic(log.topics[1]!)

  // data = abi.encode(address user [32b], uint256 amount [32b])
  const data = log.data.slice(2)  // strip 0x
  if (data.length < 128) return null
  const amount = BigInt('0x' + data.slice(64, 128)).toString()

  return {
    protocol:  'Lendle (Aave V2)',
    action:    'lendDeposit',
    tokenIn:   reserve,
    amountIn:  amount,
  }
}

export function decodeAaveV2Withdraw(
  logs: readonly RawLog[],
  _agentAddress: `0x${string}`,
): ProtocolDecodeResult | null {
  const log = logs.find(l => l.topics[0]?.toLowerCase() === AAVE_V2_WITHDRAW_TOPIC)
  if (!log) return null

  // topics[1] = indexed reserve
  const reserve = addrFromTopic(log.topics[1]!)

  // data = abi.encode(uint256 amount [32b])
  const data = log.data.slice(2)
  if (data.length < 64) return null
  const amount = BigInt('0x' + data.slice(0, 64)).toString()

  return {
    protocol:  'Lendle (Aave V2)',
    action:    'lendWithdraw',
    tokenOut:  reserve,
    amountOut: amount,
  }
}
