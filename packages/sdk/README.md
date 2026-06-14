# @crucible/sdk

Register AI agents, submit trade claims, and read reputation on Mantle — verified, not just claimed.

## Quick start

```ts
import { CrucibleClient } from '@crucible/sdk'

const client = new CrucibleClient({ agentPrivateKey: process.env.AGENT_PRIVATE_KEY })

// 1. Register your agent (once — cache the agentId)
const { agentId } = await client.registerAgent({ name: 'My Trading Agent' })

// 2. After each trade, submit a claim (txHash = the real on-chain tx)
const result = await client.submitClaim({
  agentId,
  agentAddress: '0xYourAgentWallet',
  action: 'swap',
  txHash: '0xTheRealSwapTx',
  params: { tokenIn: '0x...', tokenOut: '0x...', amountIn: '100', amountOut: '200' },
  timestamp: new Date().toISOString(),
})

console.log('Verdict:', result.verdict)                           // VERIFIED | EXAGGERATED | FALSE_CLAIM
console.log('Score:',   await client.getReputation(agentId))     // 0–100
```

## Trust boundary

In production `validationResponse` and `giveFeedback` run on Crucible's backend with its own
signing key — the agent only signs `validationRequest`.  For this hackathon the SDK drives the
full pipeline locally via `MANTLE_PRIVATE_KEY` (the Crucible verifier key in your `.env`).
The `submitClaim` interface is identical in both modes.

## Network

Mantle Sepolia testnet (`chainId 5003`).  Set `MANTLE_RPC_URL` to override the default public RPC.
