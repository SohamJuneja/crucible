/**
 * dispute-demo.ts — live DisputeManager demonstration on Mantle Sepolia.
 *
 * Opens a dispute against an existing Crucible verdict,
 * resolves it upheld=true (original verdict stands → challenger's bond is slashed),
 * and prints every tx link to Mantlescan.
 *
 * Usage: npm run dispute:demo   (requires .env + artifacts/deployed.json from deploy:dispute)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, http, parseEther, keccak256, toHex, type Abi } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { getWalletClient } from '@crucible/core'

// ── Load deployed addresses ──────────────────────────────────────────────────

const ARTIFACTS = path.resolve(process.cwd(), 'artifacts/deployed.json')
if (!fs.existsSync(ARTIFACTS)) {
  console.error('artifacts/deployed.json not found — run: npm run deploy:dispute')
  process.exit(1)
}
interface DeployedEntry { address: string; [k: string]: unknown }
const deployed = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, DeployedEntry>
if (!deployed.DisputeManager) {
  console.error('DisputeManager not deployed — run: npm run deploy:dispute')
  process.exit(1)
}

const DM_ADDRESS  = deployed.DisputeManager.address  as `0x${string}`
const TREASURY    = deployed.DisputeManager.treasury  as `0x${string}` | undefined
  ?? '0xdeadc0ffee0000000000000000000000000000ff' as `0x${string}`
const MIN_BOND    = BigInt(deployed.DisputeManager.minBond   as string ?? parseEther('0.005').toString())
const REWARD_BPS  = deployed.DisputeManager.rewardBps as number ?? 5000

// Pick an agentId to dispute — use honest-bot if available, else a fixed demo id
const SEED_PATH = path.resolve(process.cwd(), '.seed-agents.json')
interface SeedEntry { agentId: string | null }
let DEMO_AGENT_ID = 1234n
if (fs.existsSync(SEED_PATH)) {
  const seed = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Record<string, SeedEntry>
  const id = seed['honest-bot']?.agentId
  if (id) DEMO_AGENT_ID = BigInt(id)
}

// ── ABIs ─────────────────────────────────────────────────────────────────────

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
  { name: 'getDispute', type: 'function', stateMutability: 'view',
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
  { name: 'rewardPool',    type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const satisfies Abi

// ── Helpers ───────────────────────────────────────────────────────────────────

const RPC = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'
const pc  = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC) })

interface WriteParams {
  address:      `0x${string}`
  abi:          Abi
  functionName: string
  args?:        unknown[]
  value?:       bigint
}

async function writeWithGas(
  wc: ReturnType<typeof getWalletClient>,
  params: WriteParams,
  label: string,
): Promise<`0x${string}`> {
  console.log(`  [${label}] submitting...`)
  let hash: `0x${string}`
  try {
    hash = await wc.writeContract(params as never)
  } catch {
    hash = await wc.writeContract({ ...params, gas: 500_000n } as never)
  }
  const receipt = await pc.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`[${label}] reverted: ${hash}`)
  console.log(`  [${label}] confirmed ✓  ${hash}`)
  console.log(`  Explorer: https://sepolia.mantlescan.xyz/tx/${hash}`)
  return hash
}

function fmt(wei: bigint): string {
  return `${(Number(wei) / 1e18).toFixed(6)} MNT`
}

const STATUS_LABEL = ['Open', 'Upheld (challenger slashed)', 'Overturned (challenger refunded)']

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const verifier = getWalletClient()
  const verAddr  = verifier.account.address

  console.log('\n══════════════════════════════════════════════════════════════════')
  console.log('  ⚖ Crucible Dispute Protocol — Live Demo on Mantle Sepolia')
  console.log('══════════════════════════════════════════════════════════════════')
  console.log(`  DisputeManager : ${DM_ADDRESS}`)
  console.log(`  Arbiter        : ${verAddr}`)
  console.log(`  Treasury       : ${TREASURY}`)
  console.log(`  Min bond       : ${fmt(MIN_BOND)}`)
  console.log(`  Reward (if overturned) : ${REWARD_BPS / 100} % of bond (from reward pool)`)
  console.log(`  Demo agentId   : ${DEMO_AGENT_ID}`)
  console.log()

  // Build a demo verdictRef from a known evidence hash
  const verdictRef = keccak256(toHex(`crucible:verdict:${DEMO_AGENT_ID}:demo`))
  console.log(`  VerdictRef     : ${verdictRef}`)

  // ── Step 1: Open dispute ───────────────────────────────────────────────────

  console.log()
  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step 1 — Open a dispute (challenger posts bond)')
  console.log()

  const beforeBal = await pc.getBalance({ address: verAddr })
  console.log(`  Challenger balance before: ${fmt(beforeBal)}`)

  const disputeCountBefore = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'disputeCount' }) as bigint
  console.log(`  Current dispute count: ${disputeCountBefore}`)

  await writeWithGas(verifier, {
    address:      DM_ADDRESS,
    abi:          DM_ABI,
    functionName: 'openDispute',
    args:         [DEMO_AGENT_ID, verdictRef],
    value:        MIN_BOND,
  }, 'openDispute')

  const disputeId = disputeCountBefore  // 0-indexed: new dispute is at (count before open)

  const afterOpen = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'getDispute', args: [disputeId] }) as unknown as { challenger: `0x${string}`; agentId: bigint; verdictRef: `0x${string}`; bond: bigint; status: number; openedAt: bigint }
  console.log(`  Dispute #${disputeId}: status=${STATUS_LABEL[afterOpen.status]} bond=${fmt(afterOpen.bond)}`)

  // ── Step 2: Resolve upheld (challenger was wrong) ─────────────────────────

  console.log()
  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step 2 — Arbiter resolves: UPHELD (verdict stands)')
  console.log('  Challenger\'s bond is slashed to the treasury.')
  console.log()

  const treasuryBefore = await pc.getBalance({ address: TREASURY })

  await writeWithGas(verifier, {
    address:      DM_ADDRESS,
    abi:          DM_ABI,
    functionName: 'resolveDispute',
    args:         [disputeId, true, 0],  // upheld=true, no score correction
  }, 'resolveDispute(upheld)')

  const afterResolve = await pc.readContract({ address: DM_ADDRESS, abi: DM_ABI, functionName: 'getDispute', args: [disputeId] }) as unknown as { challenger: `0x${string}`; agentId: bigint; verdictRef: `0x${string}`; bond: bigint; status: number; openedAt: bigint }
  console.log(`  Dispute #${disputeId}: status=${STATUS_LABEL[afterResolve.status]}`)

  const treasuryAfter  = await pc.getBalance({ address: TREASURY })
  const challengerFinal = await pc.getBalance({ address: verAddr })
  const bondSlashed = treasuryAfter - treasuryBefore

  console.log()
  console.log('  ─── Result ───')
  console.log(`  Treasury received    : ${fmt(bondSlashed)} (slashed bond)`)
  console.log(`  Challenger net change: ≈ ${fmt(challengerFinal - beforeBal)} (bond + gas lost)`)

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log()
  console.log('══════════════════════════════════════════════════════════════════')
  console.log('  Demo complete.')
  console.log(`  Crucible verdict stood — challenger\'s ${fmt(MIN_BOND)} bond slashed.`)
  console.log(`  DisputeManager: https://sepolia.mantlescan.xyz/address/${DM_ADDRESS}`)
  console.log('══════════════════════════════════════════════════════════════════\n')
}

main().catch(err => { console.error(err); process.exit(1) })
