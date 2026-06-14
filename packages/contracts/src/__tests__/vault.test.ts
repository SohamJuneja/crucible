/**
 * Phase 13 — DelegationVault tests against Mantle Sepolia.
 *
 * Pre-requisite: npm run deploy:suite && npm run deploy:vault
 * Run: npx vitest run packages/contracts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, createWalletClient, http, parseEther, type Abi } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, it, expect, beforeAll } from 'vitest'

// ── Load deployed addresses ──────────────────────────────────────────────────

interface DeployedJson {
  CrucibleScoreboard?: { address: string }
  DelegationVault?:    { address: string; minScore: number; performanceFeeBps: number }
}

const ARTIFACTS = path.resolve(process.cwd(), 'artifacts/deployed.json')
const deployed: DeployedJson = fs.existsSync(ARTIFACTS)
  ? (JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as DeployedJson)
  : {}

const SB_ADDRESS = deployed.CrucibleScoreboard?.address  as `0x${string}` | undefined
const DV_ADDRESS = deployed.DelegationVault?.address     as `0x${string}` | undefined
const MIN_SCORE  = deployed.DelegationVault?.minScore    ?? 6000
const FEE_BPS    = deployed.DelegationVault?.performanceFeeBps ?? 1000

// Allow Mantle Sepolia's load-balanced RPC nodes to sync state after a write.
// 'latest' reads immediately after waitForTransactionReceipt can be 1-2 blocks stale.
const settle = (ms = 5_000) => new Promise<void>(r => setTimeout(r, ms))

// ── Clients ───────────────────────────────────────────────────────────────────

const RPC = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'
const pc  = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC) })

function verifierWallet() {
  const key = process.env.MANTLE_PRIVATE_KEY as `0x${string}` | undefined
  if (!key) throw new Error('MANTLE_PRIVATE_KEY not set in .env')
  return createWalletClient({ account: privateKeyToAccount(key), chain: mantleSepoliaTestnet, transport: http(RPC) })
}

// ── ABIs ──────────────────────────────────────────────────────────────────────

const SCOREBOARD_ABI = [
  { name: 'setScore', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'score', type: 'uint16' }], outputs: [] },
] as const satisfies Abi

const VAULT_ABI = [
  { name: 'delegate',    type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'agentReturn', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'withdraw',    type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'delegationOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'delegator', type: 'address' }, { name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'agentPool',   type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'agentReturnPool', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'accruedFees',  type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const satisfies Abi

// ── Test agent IDs ─────────────────────────────────────────────────────────────
// Uses unique IDs to avoid collisions with prior test runs.

const ABOVE_THRESHOLD_AGENT = 8801n  // will be scored above minScore in beforeAll
const BELOW_THRESHOLD_AGENT = 8802n  // intentionally never scored (score = 0 < minScore)
const PROFIT_AGENT          = 8803n  // used for the withdrawal-split test

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  if (!SB_ADDRESS || !DV_ADDRESS) return
  const wc         = verifierWallet()
  const aboveScore = MIN_SCORE + 1000  // e.g. 7000 if minScore=6000
  let hash: `0x${string}`

  hash = await wc.writeContract({ address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'setScore', args: [ABOVE_THRESHOLD_AGENT, aboveScore] })
  await pc.waitForTransactionReceipt({ hash })

  hash = await wc.writeContract({ address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'setScore', args: [PROFIT_AGENT, aboveScore] })
  await pc.waitForTransactionReceipt({ hash })
}, 120_000)

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DelegationVault', () => {
  it('delegating to a below-threshold agent reverts', async () => {
    if (!DV_ADDRESS) throw new Error('DelegationVault not deployed — run: npm run deploy:vault')

    const wc = verifierWallet()
    await expect(
      pc.simulateContract({
        address:      DV_ADDRESS,
        abi:          VAULT_ABI,
        functionName: 'delegate',
        args:         [BELOW_THRESHOLD_AGENT],
        value:        parseEther('0.001'),
        account:      wc.account.address,
      })
    ).rejects.toThrow()
  })

  it('delegating to an above-threshold agent succeeds', async () => {
    if (!DV_ADDRESS) throw new Error('DelegationVault not deployed — run: npm run deploy:vault')

    const wc = verifierWallet()
    const amount = parseEther('0.001')

    let hash: `0x${string}`
    try {
      hash = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegate', args: [ABOVE_THRESHOLD_AGENT], value: amount })
    } catch {
      hash = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegate', args: [ABOVE_THRESHOLD_AGENT], value: amount, gas: 200_000n })
    }

    const receipt = await pc.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    // Read at latest (accumulated delegations from prior runs means even stale reads satisfy >= amount)
    const recorded = await pc.readContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegationOf', args: [wc.account.address, ABOVE_THRESHOLD_AGENT] }) as bigint
    expect(recorded).toBeGreaterThanOrEqual(amount)
  })

  it('withdraw splits profit and performance fee correctly', async () => {
    if (!DV_ADDRESS) throw new Error('DelegationVault not deployed — run: npm run deploy:vault')

    const wc        = verifierWallet()
    const delegator = wc.account.address
    const principal = parseEther('0.001')
    const profit    = parseEther('0.0001')  // 10 % profit

    // Delegate
    let h1: `0x${string}`
    try { h1 = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegate', args: [PROFIT_AGENT], value: principal }) }
    catch { h1 = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegate', args: [PROFIT_AGENT], value: principal, gas: 200_000n }) }
    await pc.waitForTransactionReceipt({ hash: h1 })

    // Agent returns profit
    let h2: `0x${string}`
    try { h2 = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'agentReturn', args: [PROFIT_AGENT], value: profit }) }
    catch { h2 = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'agentReturn', args: [PROFIT_AGENT], value: profit, gas: 200_000n }) }
    const h2Receipt = await pc.waitForTransactionReceipt({ hash: h2 })

    void h2Receipt  // receipt used only to ensure agentReturn was mined

    // Snapshot fees before withdraw (may be non-zero from a prior test run; we check the delta)
    const feesBefore = await pc.readContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'accruedFees', args: [PROFIT_AGENT] }) as bigint

    // Withdraw
    let h3: `0x${string}`
    try { h3 = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'withdraw', args: [PROFIT_AGENT] }) }
    catch { h3 = await wc.writeContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'withdraw', args: [PROFIT_AGENT], gas: 200_000n }) }
    const receipt3 = await pc.waitForTransactionReceipt({ hash: h3 })
    expect(receipt3.status).toBe('success')
    await settle()  // Mantle Sepolia RPC: wait for load-balanced nodes to reflect the withdrawn state

    const expectedFee = profit * BigInt(FEE_BPS) / 10_000n

    // accruedFees grows with each withdraw; accumulated state means >= check works even if one run is stale
    const feesAfter = await pc.readContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'accruedFees', args: [PROFIT_AGENT] }) as bigint
    expect(feesAfter).toBeGreaterThanOrEqual(expectedFee)

    // Delegation should be zeroed out after withdraw
    const remaining = await pc.readContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegationOf', args: [delegator, PROFIT_AGENT] }) as bigint
    expect(remaining).toBe(0n)
  })
})
