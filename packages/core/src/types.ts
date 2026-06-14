export interface AgentClaim {
  agentId: string
  agentAddress: `0x${string}`
  action: 'swap' | 'lendDeposit' | 'lendWithdraw' | 'perpOpen' | 'perpClose'
  txHash: `0x${string}`
  params: {
    tokenIn?: `0x${string}`
    tokenOut?: `0x${string}`
    amountIn?: string
    amountOut?: string
    market?: string
    side?: 'long' | 'short'
    sizeUsd?: string
    leverage?: number
  }
  claimedPnlUsd?: string
  reasoning?: string
  timestamp: string
}

export type Verdict = 'VERIFIED' | 'EXAGGERATED' | 'FALSE_CLAIM' | 'UNVERIFIABLE'

export interface VerificationResult {
  claim: AgentClaim
  verdict: Verdict
  truthScore: number
  derived: {
    txExists: boolean
    txSuccess: boolean
    actualTokenIn?: string
    actualTokenOut?: string
    actualAmountIn?: string
    actualAmountOut?: string
    actualPnlUsd?: string
    slippagePct?: number
    protocol?: string   // e.g. "Agni (UniswapV3)", "Lendle (Aave V2)"
  }
  reasons: string[]
  evidenceCid?: string
}
