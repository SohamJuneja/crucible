/**
 * CrucibleClient — Crucible SDK entry point.
 *
 * Trust boundary
 * ──────────────
 * In production the agent calls `registerAgent` and `submitClaim` via the SDK,
 * but the *verifier-side* writes (validationResponse, giveFeedback) would run on
 * Crucible's own backend service with its own signing key — the agent never holds
 * that key.  For this hackathon the SDK drives the full pipeline locally, reading
 * the verifier key from the MANTLE_PRIVATE_KEY environment variable.  The same
 * `submitClaim` surface will remain unchanged once the backend is deployed.
 */
import { createPublicClient, createWalletClient, http, decodeEventLog } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { IDENTITY_REGISTRY_ADDRESS, identityRegistryAbi } from '@crucible/core'
import type { AgentClaim, VerificationResult } from '@crucible/core'
import { ingestClaim, getAgentHistory } from '@crucible/indexer'
import { computeScore } from '@crucible/scoring'

const DEFAULT_RPC = 'https://rpc.sepolia.mantle.xyz'

export interface CrucibleClientConfig {
  /** 0x-prefixed private key of the agent wallet (signs agent-side transactions) */
  agentPrivateKey: `0x${string}`
  /** Mantle Sepolia RPC URL — defaults to the public endpoint */
  rpcUrl?: string
}

export class CrucibleClient {
  private readonly agentPrivateKey: `0x${string}`
  private readonly rpcUrl:          string
  private readonly pc:              ReturnType<typeof createPublicClient>

  constructor(config: CrucibleClientConfig) {
    this.agentPrivateKey = config.agentPrivateKey
    this.rpcUrl = config.rpcUrl ?? process.env.MANTLE_RPC_URL ?? DEFAULT_RPC
    this.pc     = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(this.rpcUrl) })
  }

  /**
   * Registers this agent on the canonical ERC-8004 IdentityRegistry.
   * The agent wallet signs the transaction.
   *
   * In production, `metadata` would be pinned to IPFS and the CID used as the
   * `agentUri`; for the hackathon a placeholder HTTPS URI is used.
   *
   * @returns `{ agentId, txHash }` — save `agentId`; it is your identity on Crucible.
   */
  async registerAgent(metadata: { name: string; description?: string }): Promise<{ agentId: string; txHash: string }> {
    const account = privateKeyToAccount(this.agentPrivateKey)
    const wallet  = createWalletClient({ account, chain: mantleSepoliaTestnet, transport: http(this.rpcUrl) })

    // Production: pin JSON to IPFS → use ipfs://<cid>.  Hackathon: placeholder URI.
    const agentUri = `https://crucible.local/agent/${encodeURIComponent(metadata.name)}.json`

    let hash: `0x${string}`
    try {
      hash = await wallet.writeContract({
        address: IDENTITY_REGISTRY_ADDRESS, abi: identityRegistryAbi,
        functionName: 'register', args: [agentUri],
      })
    } catch {
      hash = await wallet.writeContract({
        address: IDENTITY_REGISTRY_ADDRESS, abi: identityRegistryAbi,
        functionName: 'register', args: [agentUri], gas: 300_000n,
      })
    }

    const receipt = await this.pc.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error(`registerAgent reverted: ${hash}`)

    let agentId: bigint | undefined
    for (const log of receipt.logs) {
      try {
        const d = decodeEventLog({ abi: identityRegistryAbi, data: log.data, topics: log.topics })
        if (d.eventName === 'Registered') {
          agentId = (d.args as unknown as { agentId: bigint }).agentId
          break
        }
      } catch {}
    }
    if (agentId === undefined) throw new Error('registerAgent: Registered event not found in receipt')

    return { agentId: agentId.toString(), txHash: hash }
  }

  /**
   * Submits a trade claim through the full Crucible verification pipeline:
   *   1. `verifyClaim` — deterministic, chain-derived verdict (no LLM)
   *   2. `validationRequest` — signed by this agent wallet
   *   3. `validationResponse` + `giveFeedback` — signed by the Crucible verifier
   *
   * @param claim  What the agent asserts it did (see AgentClaim schema in CLAUDE.md §5).
   * @returns      The VerificationResult: verdict, truthScore, derived chain data.
   */
  async submitClaim(claim: AgentClaim): Promise<VerificationResult> {
    const { verificationResult } = await ingestClaim(claim, this.agentPrivateKey)
    return verificationResult
  }

  /**
   * Returns the agent's current reputation score (0–100), recomputed from its
   * full persisted verdict history with time-decay.
   *
   * Formula (CLAUDE.md §6): 35×riskReturn + 20×winRate + 15×consistency + 30×truthfulness.
   * A FALSE_CLAIM hard-caps the total score regardless of other results.
   */
  async getReputation(agentId: string): Promise<number> {
    return computeScore(getAgentHistory(agentId))
  }
}
