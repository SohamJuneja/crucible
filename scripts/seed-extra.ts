/**
 * seed-extra.ts — registers 4 additional agents through the full Crucible
 * pipeline: real ERC-8004 registration + real MockDEX swaps + real on-chain
 * verdicts persisted to crucible-db.json.
 *
 * Agents:
 *   human-alpha  (human) — 3 × VERIFIED (consistent, honest trader)
 *   human-beta   (human) — 2 × VERIFIED + 1 × EXAGGERATED (one inflated claim)
 *   ai-alpha     (ai)    — 3 × VERIFIED (honest AI)
 *   ai-beta      (ai)    — 2 × VERIFIED (honest AI)
 *
 * Agent state (keys + agentIds) is cached in .extra-agents.json (gitignored).
 * Re-running skips already-registered agents and appends new verifications.
 *
 * Usage: npm run seed:extra
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { createPublicClient, createWalletClient, http, parseEther } from 'viem'
import { mantleSepoliaTestnet } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { getWalletClient } from '@crucible/core'
import { CrucibleClient } from '@crucible/sdk'
import type { AgentClaim } from '@crucible/core'
import fixtures from '../packages/engine/src/__tests__/fixtures.json'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATE_PATH     = path.resolve(process.cwd(), '.extra-agents.json')
const RPC_URL        = process.env.MANTLE_RPC_URL ?? 'https://rpc.sepolia.mantle.xyz'
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const AMOUNT_IN      = 1n * 10n ** 17n   // 0.1 tokens per swap

const TOKEN_A = fixtures.tokenA as `0x${string}`
const TOKEN_B = fixtures.tokenB as `0x${string}`
const DEX     = fixtures.dex    as `0x${string}`

// ── Types ──────────────────────────────────────────────────────────────────────

const AGENT_NAMES = ['human-alpha', 'human-beta', 'ai-alpha', 'ai-beta'] as const
type AgentName = (typeof AGENT_NAMES)[number]

const COHORT: Record<AgentName, 'human' | 'ai'> = {
  'human-alpha': 'human',
  'human-beta':  'human',
  'ai-alpha':    'ai',
  'ai-beta':     'ai',
}

interface AgentState {
  privateKey: `0x${string}`
  address:    `0x${string}`
  agentId:    string | null
  cohort:     'human' | 'ai'
}

type ExtraState = Record<AgentName, AgentState>

// ── ABIs (MockDEX on Mantle Sepolia — same contracts as seed-agents) ───────────

const ERC20_ABI = [
  { name: 'mint',    type: 'function' as const, stateMutability: 'nonpayable',
    inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'approve', type: 'function' as const, stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const

const DEX_ABI = [
  { name: 'swap', type: 'function' as const, stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn',  type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'tokenOut', type: 'address' },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }] },
] as const

// ── Client factory ─────────────────────────────────────────────────────────────

const pc = createPublicClient({ chain: mantleSepoliaTestnet, transport: http(RPC_URL) })

function makeWallet(pk: `0x${string}`) {
  return createWalletClient({
    account:   privateKeyToAccount(pk),
    chain:     mantleSepoliaTestnet,
    transport: http(RPC_URL),
  })
}

type WC = ReturnType<typeof makeWallet>

// ── State management ───────────────────────────────────────────────────────────

function loadState(): ExtraState {
  if (fs.existsSync(STATE_PATH)) {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) as ExtraState
  }
  const state = {} as ExtraState
  for (const name of AGENT_NAMES) {
    const pk = generatePrivateKey()
    state[name] = { privateKey: pk, address: privateKeyToAccount(pk).address, agentId: null, cohort: COHORT[name] }
  }
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
  console.log(`[state] generated fresh wallets → ${STATE_PATH}`)
  return state
}

function saveState(state: ExtraState): void {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2))
}

// ── Fund ───────────────────────────────────────────────────────────────────────

async function fund(name: AgentName, agent: AgentState): Promise<void> {
  const balance = await pc.getBalance({ address: agent.address })
  if (balance >= parseEther('0.5')) {
    console.log(`[${name}] balance ${(Number(balance) / 1e18).toFixed(4)} MNT — sufficient`)
    return
  }
  const verifier = getWalletClient()
  console.log(`[${name}] low balance (${(Number(balance) / 1e18).toFixed(4)} MNT) — sending 1 MNT from verifier...`)
  let hash: `0x${string}`
  try {
    hash = await verifier.sendTransaction({ to: agent.address, value: parseEther('1'), gas: 21_000n })
  } catch {
    hash = await verifier.sendTransaction({ to: agent.address, value: parseEther('1') })
  }
  await pc.waitForTransactionReceipt({ hash })
  console.log(`[${name}] funded ✓  ${hash}`)
}

// ── Registration ───────────────────────────────────────────────────────────────

async function ensureRegistered(name: AgentName, agent: AgentState, state: ExtraState): Promise<string> {
  if (agent.agentId !== null) {
    console.log(`[${name}] agentId=${agent.agentId} (cached — skipping registration)`)
    return agent.agentId
  }
  console.log(`[${name}] registering via CrucibleClient...`)
  const client = new CrucibleClient({ agentPrivateKey: agent.privateKey })
  const { agentId, txHash } = await client.registerAgent({
    name,
    description: `Crucible extra agent: ${name} (cohort=${agent.cohort})`,
  })
  agent.agentId = agentId
  saveState(state)
  console.log(`[${name}] registered agentId=${agentId}  tx=${txHash}`)
  return agentId
}

// ── Swap helper ────────────────────────────────────────────────────────────────

async function sendTx(wallet: WC, params: object, label: string): Promise<`0x${string}`> {
  console.log(`  ${label}...`)
  let hash: `0x${string}`
  try {
    hash = await wallet.writeContract(params as never)
  } catch {
    // Mantle L2 gas estimation can fail spuriously — use a high explicit limit per CLAUDE.md
    hash = await wallet.writeContract(Object.assign({}, params, { gas: 5_000_000n }) as never)
  }
  const receipt = await pc.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} REVERTED  ${hash}`)
  console.log(`  ${label} ✓  ${hash}`)
  return hash
}

async function doSwap(wallet: WC, amountIn: bigint): Promise<{
  txHash:          `0x${string}`
  actualAmountIn:  bigint
  actualAmountOut: bigint
}> {
  const agent = wallet.account.address
  await sendTx(wallet, { address: TOKEN_A, abi: ERC20_ABI, functionName: 'mint',    args: [agent, amountIn] }, 'mint tokenA')
  await sendTx(wallet, { address: TOKEN_A, abi: ERC20_ABI, functionName: 'approve', args: [DEX,   amountIn] }, 'approve DEX')
  const txHash = await sendTx(wallet, { address: DEX, abi: DEX_ABI, functionName: 'swap', args: [TOKEN_A, amountIn, TOKEN_B] }, 'swap')

  const receipt = await pc.getTransactionReceipt({ hash: txHash })
  const outLog  = receipt.logs.find(
    l => l.address.toLowerCase() === TOKEN_B.toLowerCase() &&
         l.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
         l.topics[2]?.slice(-40).toLowerCase() === agent.slice(2).toLowerCase(),
  )
  const actualAmountOut = outLog ? BigInt(outLog.data) : amountIn * 2n
  return { txHash, actualAmountIn: amountIn, actualAmountOut }
}

// ── Honest agent runner (N verified swaps) ─────────────────────────────────────

async function runVerifiedAgent(name: AgentName, state: ExtraState, swapCount: number): Promise<void> {
  console.log(`\n══════ ${name} (${state[name].cohort}) ══════`)
  await fund(name, state[name])
  const agentId = await ensureRegistered(name, state[name], state)
  const wallet  = makeWallet(state[name].privateKey)
  const client  = new CrucibleClient({ agentPrivateKey: state[name].privateKey })

  for (let i = 0; i < swapCount; i++) {
    console.log(`\n  [swap ${i + 1}/${swapCount}] honest claim → expect VERIFIED`)
    const swap = await doSwap(wallet, AMOUNT_IN)
    const claim: AgentClaim = {
      agentId,
      agentAddress: wallet.account.address,
      action:       'swap',
      txHash:       swap.txHash,
      params: {
        tokenIn:   TOKEN_A,
        tokenOut:  TOKEN_B,
        amountIn:  swap.actualAmountIn.toString(),
        amountOut: swap.actualAmountOut.toString(),
      },
      timestamp: new Date().toISOString(),
    }
    const result = await client.submitClaim(claim)
    console.log(`  [swap ${i + 1}] verdict=${result.verdict}  truthScore=${result.truthScore.toFixed(3)}`)
  }
}

// ── human-beta: 2 honest + 1 exaggerated ──────────────────────────────────────

async function runHumanBeta(state: ExtraState): Promise<void> {
  const name = 'human-beta' as const
  console.log(`\n══════ ${name} (human) ══════`)
  await fund(name, state[name])
  const agentId = await ensureRegistered(name, state[name], state)
  const wallet  = makeWallet(state[name].privateKey)
  const client  = new CrucibleClient({ agentPrivateKey: state[name].privateKey })

  // Swap 1: honest → VERIFIED
  console.log('\n  [swap 1/3] honest claim → expect VERIFIED')
  const swap1 = await doSwap(wallet, AMOUNT_IN)
  await client.submitClaim({
    agentId, agentAddress: wallet.account.address, action: 'swap',
    txHash:    swap1.txHash,
    params: { tokenIn: TOKEN_A, tokenOut: TOKEN_B,
              amountIn:  swap1.actualAmountIn.toString(),
              amountOut: swap1.actualAmountOut.toString() },
    timestamp: new Date().toISOString(),
  })
  console.log('  [swap 1] submitted → expect VERIFIED')

  // Swap 2: honest → VERIFIED
  console.log('\n  [swap 2/3] honest claim → expect VERIFIED')
  const swap2 = await doSwap(wallet, AMOUNT_IN)
  await client.submitClaim({
    agentId, agentAddress: wallet.account.address, action: 'swap',
    txHash:    swap2.txHash,
    params: { tokenIn: TOKEN_A, tokenOut: TOKEN_B,
              amountIn:  swap2.actualAmountIn.toString(),
              amountOut: swap2.actualAmountOut.toString() },
    timestamp: new Date().toISOString(),
  })
  console.log('  [swap 2] submitted → expect VERIFIED')

  // Swap 3: inflate amountOut by 20% → expect EXAGGERATED
  console.log('\n  [swap 3/3] inflated claim (+20%) → expect EXAGGERATED')
  const swap3 = await doSwap(wallet, AMOUNT_IN)
  const inflatedOut = (swap3.actualAmountOut * 120n / 100n).toString()
  console.log(`  actual=${swap3.actualAmountOut}  claimed=${inflatedOut}`)
  await client.submitClaim({
    agentId, agentAddress: wallet.account.address, action: 'swap',
    txHash:    swap3.txHash,
    params: { tokenIn: TOKEN_A, tokenOut: TOKEN_B,
              amountIn:  swap3.actualAmountIn.toString(),
              amountOut: inflatedOut },
    timestamp: new Date().toISOString(),
  })
  console.log('  [swap 3] submitted → expect EXAGGERATED')
}

// ── human-beta swap 3 only (EXAGGERATED) ──────────────────────────────────────
// human-beta already has swaps 1+2 (VERIFIED) in the DB from a prior run.
// This function adds only the final inflated claim.

async function runHumanBetaSwap3(state: ExtraState): Promise<void> {
  const name = 'human-beta' as const
  console.log(`\n══════ ${name} — swap 3 (EXAGGERATED) ══════`)
  await fund(name, state[name])
  const agentId = await ensureRegistered(name, state[name], state)
  const wallet  = makeWallet(state[name].privateKey)
  const client  = new CrucibleClient({ agentPrivateKey: state[name].privateKey })

  console.log('\n  [swap 3/3] inflated claim (+20%) → expect EXAGGERATED')
  const swap3 = await doSwap(wallet, AMOUNT_IN)
  const inflatedOut = (swap3.actualAmountOut * 120n / 100n).toString()
  console.log(`  actual=${swap3.actualAmountOut}  claimed=${inflatedOut}`)
  const result = await client.submitClaim({
    agentId, agentAddress: wallet.account.address, action: 'swap',
    txHash:    swap3.txHash,
    params: { tokenIn: TOKEN_A, tokenOut: TOKEN_B,
              amountIn:  swap3.actualAmountIn.toString(),
              amountOut: inflatedOut },
    timestamp: new Date().toISOString(),
  })
  console.log(`  [swap 3] verdict=${result.verdict}  truthScore=${result.truthScore.toFixed(3)}`)
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  if (fixtures.honestSwap.txHash.startsWith('0x0000')) {
    console.error('fixtures.json is a placeholder — run: npm run make:fixtures first')
    process.exit(1)
  }

  console.log('═══════════════════════════════════════════════')
  console.log('  Crucible seed-extra: continuing from partial run')
  console.log('  human-alpha (212): already done (3×VERIFIED in DB)')
  console.log('  human-beta  (213): needs swap 3 (EXAGGERATED)')
  console.log('  ai-alpha    (214): needs 3 swaps')
  console.log('  ai-beta     (215): needs 2 swaps')
  console.log('═══════════════════════════════════════════════')

  const state = loadState()

  // Sequential execution — Mantle nonce ordering requirement
  // human-alpha: already has 3×VERIFIED in DB — skip
  await runHumanBetaSwap3(state)
  await runVerifiedAgent('ai-alpha', state, 3)
  await runVerifiedAgent('ai-beta', state, 2)

  console.log('\n\n✅ seed-extra complete.')
  console.log('   Run:  npm run snapshot   — refresh apps/web/data/snapshot.json')
  console.log('   Then: npm run build -w @crucible/web  — confirm build passes')
}

main().catch(err => { console.error(err); process.exit(1) })
