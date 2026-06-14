// keccak256("Transfer(address,address,uint256)")
export const TRANSFER_TOPIC =
  '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as const

export interface TransferLog {
  token: `0x${string}`
  from:  `0x${string}`
  to:    `0x${string}`
  value: bigint
}

export interface RawLog {
  address: `0x${string}`
  topics:  readonly `0x${string}`[]
  data:    `0x${string}`
}

export function decodeTransferLog(log: RawLog): TransferLog | null {
  if (
    log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC.toLowerCase() ||
    log.topics.length < 3
  ) return null

  const from  = `0x${log.topics[1]!.slice(-40)}` as `0x${string}`
  const to    = `0x${log.topics[2]!.slice(-40)}` as `0x${string}`
  const value = log.data === '0x' || log.data === '0x0' ? 0n : BigInt(log.data)

  return { token: log.address, from, to, value }
}

export function decodeAllTransfers(logs: readonly RawLog[]): TransferLog[] {
  return logs.map(decodeTransferLog).filter((t): t is TransferLog => t !== null)
}
