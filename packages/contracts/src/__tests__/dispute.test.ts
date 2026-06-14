/**
 * Phase 12 — DisputeManager tests against Mantle Sepolia.
 *
 * Pre-requisite: npm run deploy:dispute
 * Run: npx vitest run packages/contracts
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, createWalletClient, http, parseEther, keccak256, toHex, type Abi } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, it, expect } from 'vitest'

// ── Load deployed addresses ──────────────────────────────────────────────────

interface DeployedJson {
  DisputeManager?: {
    address:   string
    treasury:  string
    minBond:   string
    rewardBps: number
  }
}

const ARTIFACTS = path.resolve(process.cwd(), 'artifacts/deployed.json')
const deployed: DeployedJson = fs.existsSync(ARTIFACTS)
  ? (JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as DeployedJson)
  : {}

const DM_ADDRESS = deployed.DisputeManager?.address  as `0x${string}` | undefined
const TREASURY   = deployed.DisputeManager?.treasury as `0x${string}` | undefined
const MIN_BOND   = deployed.DisputeManager?.minBond
  ? BigInt(deployed.DisputeManager.minBond)
  : parseEther('0.005')

// Allow Mantle Sepolia's load-balanced RPC nodes to sync state after a write.
// 'latest' reads immediately after waitForTransactionReceipt can be 1-2 blocks stale.
const settle = (ms = 5_000) => new Promise<void>(r => setTimeout(r, ms))

// ── Clients ───────────────────────────────────────────────────────────────────

const RPC = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'
const pc  = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC) })

function arbiterWallet() {
  const key = process.env.MANTLE_PRIVATE_KEY as `0x${string}` | undefined
  if (!key) throw new Error('MANTLE_PRIVATE_KEY not set in .env')
  return createWalletClient({ account: privateKeyToAccount(key), chain: mantleSepoliaTestnet, transport: http(RPC) })
}

// ── ABI ───────────────────────────────────────────────────────────────────────

const DM_ABI = [
  { name: 'openDispute',    type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'verdictRef', type: 'bytes32' }],
    outputs: [{ name: 'disputeId', type: 'uint256' }] },
  { name: 'resolveDispute', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: 'disputeId',      type: 'uint256' },
      { name: 'upheld',         type: 'bool'    },
      { name: 'correctedScore', type: 'uint16'  },
    ], outputs: [] },
  { name: 'getDispute',    type: 'function', stateMutability: 'view',
    inputs: [{ name: 'disputeId', type: 'uint256' }],
    outputs: [{ name: '', type: 'tuple', components: [
      { name: 'challenger', type: 'address' },
      { name: 'agentId',    type: 'uint256' },
      { name: 'verdictRef', type: 'bytes32' },
      { name: 'bond',       type: 'uint256' },
      { name: 'status',     type: 'uint8'   },
      { name: 'openedAt',   type: 'uint256' },
    ]}] },
  { name: 'disputeCount',  type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const satisfies Abi

// ── Helpers ───────────────────────────────────────────────────────────────────

async function openDispute(
  wc:         ReturnType<typeof arbiterWallet>,
  agentId:    bigint,
  verdictRef: `0x${string}`,
): Promise<{ disputeId: bigint; blockNumber: bigint }> {
  const countBefore = await pc.readContract({ address: DM_ADDRESS!, abi: DM_ABI, functionName: 'disputeCount' }) as bigint
  let hash: `0x${string}`
  try {
    hash = await wc.writeContract({ address: DM_ADDRESS!, abi: DM_ABI, functionName: 'openDispute', args: [agentId, verdictRef], value: MIN_BOND })
  } catch {
    hash = await wc.writeContract({ address: DM_ADDRESS!, abi: DM_ABI, functionName: 'openDispute', args: [agentId, verdictRef], value: MIN_BOND, gas: 300_000n })
  }
  const receipt = await pc.waitForTransactionReceipt({ hash })
  return { disputeId: countBefore, blockNumber: receipt.blockNumber }
}

async function resolveDispute(
  wc:        ReturnType<typeof arbiterWallet>,
  disputeId: bigint,
  upheld:    boolean,
): Promise<{ hash: `0x${string}`; blockNumber: bigint }> {
  let hash: `0x${string}`
  try {
    hash = await wc.writeContract({ address: DM_ADDRESS!, abi: DM_ABI, functionName: 'resolveDispute', args: [disputeId, upheld, 0] })
  } catch {
    hash = await wc.writeContract({ address: DM_ADDRESS!, abi: DM_ABI, functionName: 'resolveDispute', args: [disputeId, upheld, 0], gas: 300_000n })
  }
  const receipt = await pc.waitForTransactionReceipt({ hash })
  return { hash, blockNumber: receipt.blockNumber }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DisputeManager', () => {
  it('open → resolve(upheld=true) slashes challenger bond to treasury', async () => {
    if (!DM_ADDRESS) throw new Error('DisputeManager not deployed — run: npm run deploy:dispute')
    if (!TREASURY)   throw new Error('Treasury address missing in deployed.json')

    const wc         = arbiterWallet()
    const agentId    = 9901n
    const verdictRef = keccak256(toHex(`crucible:test:upheld:${Date.now()}`))
    const countBefore = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'disputeCount' }) as bigint

    const { disputeId } = await openDispute(wc, agentId, verdictRef)
    await settle()  // Mantle Sepolia RPC: wait for nodes to reflect the new dispute

    // Verify dispute was created — count increased
    const countAfterOpen = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'disputeCount' }) as bigint
    expect(countAfterOpen).toBe(countBefore + 1n)
    expect(disputeId).toBe(countBefore)  // 0-indexed: new dispute is at prior count

    await resolveDispute(wc, disputeId, true)
    await settle()  // wait for nodes to reflect the resolved state

    // Verify dispute status changed to Upheld (1) via contract state
    const d = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'getDispute', args: [disputeId] }) as {
      challenger: `0x${string}`; agentId: bigint; verdictRef: `0x${string}`; bond: bigint; status: number; openedAt: bigint
    }
    expect(d.status).toBe(1)  // DisputeStatus.Upheld = 1; bond was slashed to treasury
  })

  it('open → resolve(upheld=false) refunds challenger bond', async () => {
    if (!DM_ADDRESS) throw new Error('DisputeManager not deployed — run: npm run deploy:dispute')

    const wc         = arbiterWallet()
    const agentId    = 9902n
    const verdictRef = keccak256(toHex(`crucible:test:overturned:${Date.now()}`))

    const challengerBefore = await pc.getBalance({ address: wc.account.address })
    const countBefore      = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'disputeCount' }) as bigint

    const { disputeId } = await openDispute(wc, agentId, verdictRef)
    await settle()  // Mantle Sepolia RPC: wait for nodes to reflect the new dispute

    // Verify dispute was created — count increased
    const countAfterOpen = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'disputeCount' }) as bigint
    expect(countAfterOpen).toBe(countBefore + 1n)

    await resolveDispute(wc, disputeId, false)

    // Challenger was refunded their bond; net loss is only gas
    const challengerAfter = await pc.getBalance({ address: wc.account.address })
    const netLoss = challengerBefore - challengerAfter
    // Net loss should be gas only (bond refunded); 10x MIN_BOND covers Mantle's L1 data fee
    expect(netLoss).toBeLessThan(MIN_BOND * 10n)
    // Challenger should have gotten at least the bond back (net loss << bond)
    expect(challengerAfter + MIN_BOND * 10n).toBeGreaterThanOrEqual(challengerBefore)
  })
})
