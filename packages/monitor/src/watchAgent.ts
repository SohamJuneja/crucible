/**
 * watchAgent — lightweight block-watcher for registered agent wallets.
 *
 * Subscribes to new blocks via viem's watchBlocks; for each block scans
 * transactions originating from the monitored agent and emits AgentEvent
 * objects that the indexer / alert bot can consume.
 *
 * Returns a cleanup function that cancels the subscription.
 */
import type { PublicClient } from 'viem'
import type { AgentEvent } from './types.js'

export type WatchCleanup = () => void

export function watchAgent(
  agentAddress: `0x${string}`,
  publicClient: Pick<PublicClient, 'watchBlocks'>,
  onEvent:      (event: AgentEvent) => void,
): WatchCleanup {
  const agent = agentAddress.toLowerCase()

  const unwatch = (publicClient as PublicClient).watchBlocks({
    includeTransactions: true,
    onBlock(block) {
      if (!Array.isArray(block.transactions)) return
      for (const tx of block.transactions) {
        if (typeof tx !== 'object') continue
        if (tx.from?.toLowerCase() !== agent) continue
        onEvent({
          type:         'tx_detected',
          agentAddress,
          txHash:       tx.hash as `0x${string}`,
          to:           (tx.to ?? null) as `0x${string}` | null,
          value:        tx.value,
          blockNumber:  block.number,
        })
      }
    },
  })

  return unwatch
}
