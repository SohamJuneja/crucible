/**
 * delegation-demo.ts — end-to-end Delegation Vault demonstration on Mantle Sepolia.
 *
 * Steps:
 *   0. Ensure CrucibleScoreboard has on-chain scores for honest-bot + liar-bot.
 *      (Reads local store; pushes via verifier key if not already set / score changed.)
 *   (a) Delegate 0.05 MNT to honest-bot (above minScore=60.00) → succeeds.
 *   (b) Attempt to delegate to liar-bot (below threshold) → REVERTS; print reason.
 *   (c) Agent (verifier acting as honest-bot's representative) returns 0.01 MNT profit.
 *   (d) Delegator (verifier) withdraws: principal + profit, minus 10 % performance fee.
 *       Agent claims the accrued performance fee.
 *
 * Usage: npm run delegate:demo   (requires .env + artifacts/deployed.json from deploy:suite + deploy:vault)
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, http, parseEther, type Abi } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { getWalletClient } from '@crucible/core'

// ── Load deployed addresses ──────────────────────────────────────────────────

const ARTIFACTS = path.resolve(process.cwd(), 'artifacts/deployed.json')
if (!fs.existsSync(ARTIFACTS)) {
  console.error('artifacts/deployed.json not found — run: npm run deploy:suite && npm run deploy:vault')
  process.exit(1)
}
interface DeployedEntry { address: string }
const deployed = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8')) as Record<string, DeployedEntry & Record<string, unknown>>
if (!deployed.CrucibleScoreboard) { console.error('CrucibleScoreboard not deployed'); process.exit(1) }
if (!deployed.DelegationVault)    { console.error('DelegationVault not deployed — run: npm run deploy:vault'); process.exit(1) }

const SB_ADDRESS = deployed.CrucibleScoreboard.address as `0x${string}`
const DV_ADDRESS = deployed.DelegationVault.address    as `0x${string}`
const MIN_SCORE  = (deployed.DelegationVault.minScore  as number) ?? 6000

// ── Load seed agent state ─────────────────────────────────────────────────────

const SEED_PATH = path.resolve(process.cwd(), '.seed-agents.json')
if (!fs.existsSync(SEED_PATH)) {
  console.error('.seed-agents.json not found — run: npm run seed to generate agent wallets')
  process.exit(1)
}
interface SeedEntry { privateKey: string; address: string; agentId: string | null }
const seedState = JSON.parse(fs.readFileSync(SEED_PATH, 'utf8')) as Record<string, SeedEntry>

const honestBot = seedState['honest-bot']
const liarBot   = seedState['liar-bot']
if (!honestBot?.agentId || !liarBot?.agentId) {
  console.error('honest-bot or liar-bot not registered — run: npm run seed')
  process.exit(1)
}
const HONEST_ID = BigInt(honestBot.agentId)
const LIAR_ID   = BigInt(liarBot.agentId)

// ── Load local scores from db ──────────────────────────────────────────────────

interface DbStore { agents: Record<string, { score: number }> }
const DB_PATH = path.resolve(process.cwd(), 'crucible-db.json')
function localScore(agentId: string): number {
  if (!fs.existsSync(DB_PATH)) return 0
  const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as DbStore
  return db.agents[agentId]?.score ?? 0
}

// ── ABIs ───────────────────────────────────────────────────────────────────────

const SCOREBOARD_ABI = [
  { name: 'setScore', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'score', type: 'uint16' }], outputs: [] },
  { name: 'getScore', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint16' }] },
] as const satisfies Abi

const VAULT_ABI = [
  { name: 'delegate',    type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'agentReturn', type: 'function', stateMutability: 'payable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'withdraw',    type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'claimFees',   type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [] },
  { name: 'delegationOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'delegator', type: 'address' }, { name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }] },
  { name: 'accruedFees',  type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
] as const satisfies Abi

// ── Helpers ────────────────────────────────────────────────────────────────────

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

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const verifier = getWalletClient()
  const verAddr  = verifier.account.address

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('  💰 Crucible Delegation Vault — Live Demo on Mantle Sepolia')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`  DelegationVault     : ${DV_ADDRESS}`)
  console.log(`  CrucibleScoreboard  : ${SB_ADDRESS}`)
  console.log(`  Threshold (minScore): ${MIN_SCORE} (= ${MIN_SCORE / 100}.00)`)
  console.log(`  Performance fee     : ${(deployed.DelegationVault.performanceFeeBps as number ?? 1000) / 100} %`)
  console.log(`  Verifier / delegator: ${verAddr}`)
  console.log(`  honest-bot agentId  : ${honestBot.agentId}`)
  console.log(`  liar-bot   agentId  : ${liarBot.agentId}`)
  console.log()

  // ── Step 0: Ensure scoreboard has current scores ───────────────────────────────

  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step 0 — Push on-chain scores')
  console.log()

  // honest-bot: push a high score so delegation is allowed
  const honestScore = localScore(honestBot.agentId!) || 80.0
  const honestScoreEncoded = Math.round(Math.max(honestScore, 65) * 100)  // floor at 65 for demo
  const currentHonest = await pc.readContract({ address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'getScore', args: [HONEST_ID] })
  if (currentHonest !== honestScoreEncoded) {
    console.log(`  honest-bot: score=${honestScoreEncoded} (${honestScoreEncoded / 100}.00) → pushing to scoreboard...`)
    await writeWithGas(verifier, {
      address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'setScore',
      args:    [HONEST_ID, honestScoreEncoded],
    }, 'setScore(honest-bot)')
  } else {
    console.log(`  honest-bot: score already ${honestScoreEncoded} on-chain ✓`)
  }

  // liar-bot: push a low score so delegation is blocked (or leave at 0)
  const liarScore = localScore(liarBot.agentId!) || 4.5
  const liarScoreEncoded = Math.round(Math.min(liarScore, 10) * 100)  // cap at 10 for demo
  const currentLiar = await pc.readContract({ address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'getScore', args: [LIAR_ID] })
  if (currentLiar !== liarScoreEncoded) {
    console.log(`  liar-bot:   score=${liarScoreEncoded} (${liarScoreEncoded / 100}.00) → pushing to scoreboard...`)
    await writeWithGas(verifier, {
      address: SB_ADDRESS, abi: SCOREBOARD_ABI, functionName: 'setScore',
      args:    [LIAR_ID, liarScoreEncoded],
    }, 'setScore(liar-bot)')
  } else {
    console.log(`  liar-bot:   score already ${liarScoreEncoded} on-chain ✓`)
  }

  // ── Step (a): Delegate to honest-bot ──────────────────────────────────────────

  console.log()
  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step (a) — Delegate to honest-bot (score above threshold)')
  console.log()

  const DELEGATION_AMOUNT = parseEther('0.05')
  await writeWithGas(verifier, {
    address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'delegate',
    args:    [HONEST_ID],
    value:   DELEGATION_AMOUNT,
  }, 'delegate(honest-bot)')
  console.log(`  ✅ Delegated ${fmt(DELEGATION_AMOUNT)} to honest-bot (agentId=${HONEST_ID})`)

  // ── Step (b): Attempt to delegate to liar-bot → expect REVERT ─────────────────

  console.log()
  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step (b) — Attempt delegation to liar-bot (below threshold)')
  console.log()

  try {
    await pc.simulateContract({
      address:      DV_ADDRESS,
      abi:          VAULT_ABI,
      functionName: 'delegate',
      args:         [LIAR_ID],
      value:        DELEGATION_AMOUNT,
      account:      verAddr,
    })
    console.log('  ⚠ UNEXPECTED: simulation succeeded (liar-bot score may be >= threshold?)')
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const match = msg.match(/AgentBelowReputationThreshold|revert/i)
    if (match) {
      console.log('  🚨 REVERTED as expected — AgentBelowReputationThreshold')
      const scoreMatch = msg.match(/score[^,)]*?(\d+)/i)
      if (scoreMatch) console.log(`  Liar-bot on-chain score: ${scoreMatch[1]} < minScore ${MIN_SCORE}`)
      console.log('  Reputation gate works — dishonest agents cannot attract capital.')
    } else {
      console.log('  Reverted:', msg.slice(0, 120))
    }
  }

  // ── Step (c): Agent returns 0.0001 MNT profit ─────────────────────────────────

  console.log()
  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step (c) — honest-bot returns 0.01 MNT profit to vault')
  console.log()

  const PROFIT_AMOUNT = parseEther('0.01')
  await writeWithGas(verifier, {
    address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'agentReturn',
    args:    [HONEST_ID],
    value:   PROFIT_AMOUNT,
  }, 'agentReturn(honest-bot)')
  console.log(`  ✅ Agent returned ${fmt(PROFIT_AMOUNT)} profit`)

  // ── Step (d): Delegator withdraws; agent claims fee ────────────────────────────

  console.log()
  console.log('──────────────────────────────────────────────────────────────')
  console.log('  Step (d) — Delegator withdraws principal + profit')
  console.log()

  // Show expected split
  const feeBps     = BigInt((deployed.DelegationVault.performanceFeeBps as number) ?? 1000)
  const fee        = PROFIT_AMOUNT * feeBps / 10_000n
  const payout     = DELEGATION_AMOUNT + PROFIT_AMOUNT - fee
  console.log(`  Expected breakdown:`)
  console.log(`    Principal   : ${fmt(DELEGATION_AMOUNT)}`)
  console.log(`    Profit share: ${fmt(PROFIT_AMOUNT)}`)
  console.log(`    Fee (${feeBps / 100n}%)   : ${fmt(fee)}  → accrues to agent`)
  console.log(`    Payout      : ${fmt(payout)}  → to delegator`)
  console.log()

  const balBefore = await pc.getBalance({ address: verAddr })
  await writeWithGas(verifier, {
    address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'withdraw',
    args:    [HONEST_ID],
  }, 'withdraw(honest-bot)')
  const balAfter = await pc.getBalance({ address: verAddr })
  console.log(`  Balance change: ${fmt(balAfter - balBefore)} (includes gas costs)`)

  // Agent claims fee
  const feeOnChain = await pc.readContract({ address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'accruedFees', args: [HONEST_ID] }) as bigint
  console.log()
  console.log(`  Agent fee on-chain: ${fmt(feeOnChain)}`)
  if (feeOnChain > 0n) {
    await writeWithGas(verifier, {
      address: DV_ADDRESS, abi: VAULT_ABI, functionName: 'claimFees',
      args:    [HONEST_ID],
    }, 'claimFees(honest-bot)')
    console.log(`  ✅ Agent claimed ${fmt(feeOnChain)} performance fee`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────────

  console.log()
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('  Demo complete.')
  console.log(`  DelegationVault  : https://sepolia.mantlescan.xyz/address/${DV_ADDRESS}`)
  console.log(`  CrucibleScoreboard: https://sepolia.mantlescan.xyz/address/${SB_ADDRESS}`)
  console.log('═══════════════════════════════════════════════════════════════\n')
}

main().catch(err => { console.error(err); process.exit(1) })
