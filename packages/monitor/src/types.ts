/** An intended (not yet broadcast) transaction. */
export interface Intent {
  agentAddress: `0x${string}`
  to:           `0x${string}`
  data:         `0x${string}`
  value?:       bigint
}

export type Decision = 'ALLOW' | 'WARN' | 'BLOCK'

export interface RiskAssessment {
  decision:  Decision
  riskScore: number      // 0–100
  reasons:   string[]    // machine-readable rule identifiers
}

export interface AgentEvent {
  type:         'tx_detected'
  agentAddress: `0x${string}`
  txHash:       `0x${string}`
  to:           `0x${string}` | null
  value:        bigint
  blockNumber:  bigint
}
