import { decodeAllTransfers, type RawLog } from './transfer.js'

export interface LendDepositResult {
  token:  `0x${string}`
  amount: string
}

/**
 * Infers a lending deposit from Transfer events: the largest-value token transfer
 * OUT of the agent address is the deposited asset.
 */
export function decodeLendDepositFromLogs(
  logs: readonly RawLog[],
  agentAddress: `0x${string}`,
): LendDepositResult | null {
  const transfers = decodeAllTransfers(logs)
  const agent = agentAddress.toLowerCase()

  const deposit = transfers
    .filter(t => t.from.toLowerCase() === agent && t.value > 0n)
    .sort((a, b) => (a.value > b.value ? -1 : a.value < b.value ? 1 : 0))[0]

  if (!deposit) return null
  return { token: deposit.token, amount: deposit.value.toString() }
}
